'use strict';

const { installFetchPolyfill } = require('./src/util/fetchPolyfill');
// GitCode 插件 runtime 为 node16，无全局 fetch；注入最小 polyfill，否则
// OIDC SDK 会回退 require('undici') 导致 "Cannot find module 'undici'"。
installFetchPolyfill();

const fs = require('fs');
const path = require('path');

const ReportScanner = require('./src/parser/ReportScanner');
const JacocoParser = require('./src/parser/JacocoParser');
const CoveragePyParser = require('./src/parser/CoveragePyParser');
const GoTestParser = require('./src/parser/GoTestParser');
const GcovParser = require('./src/parser/GcovParser');
const C8Parser = require('./src/parser/C8Parser');
const CargoLlvmCovParser = require('./src/parser/CargoLlvmCovParser');
const CoverageNormalizer = require('./src/normalizer/CoverageNormalizer');
const ObsUploader = require('./src/obs/ObsUploader');
const { detectPlatform } = require('./src/util/platform');

const PARSER_MAP = {
  jacoco: JacocoParser,
  'coverage-py': CoveragePyParser,
  'go-test': GoTestParser,
  lcov: GcovParser,
  gcov: GcovParser,
  c8: C8Parser,
  'cargo-llvm-cov': CargoLlvmCovParser,
};

const REGION_ENV_CANDIDATES = ['CLOUD_REGION', 'CLOUD_REGION_ID', 'REGION_ID', 'HUAWEICLOUD_REGION'];

// ---------- 通用辅助 ----------

function getInput(name) {
  return (process.env[`INPUT_${name.toUpperCase()}`] || '').trim();
}

function setOutput(key, value, env = process.env) {
  // 按平台选择步骤输出文件：GitHub 使用 GITHUB_OUTPUT；GitCode 使用 ATOMGIT_OUTPUT，
  // 兼容旧变量 STEP_OUTPUT。兼容 runner 同时注入 GITHUB_* 时不得写入 GITHUB_OUTPUT。
  const outputVars = detectPlatform(env) === 'github'
    ? ['GITHUB_OUTPUT']
    : ['ATOMGIT_OUTPUT', 'STEP_OUTPUT'];
  const outputFile = outputVars.map((name) => (env[name] || '').trim()).find(Boolean) || '';
  if (!outputFile) {
    console.log(`[WARN] ${outputVars.join('/')} env not set, skip output: ${key}=${value}`);
    return;
  }
  let filePath;
  try {
    filePath = fs.statSync(outputFile).isDirectory() ? path.join(outputFile, 'output') : outputFile;
  } catch (e) {
    const parentDir = path.dirname(outputFile);
    if (!(fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory())) {
      console.log(`[WARN] ${outputVars.join('/')} path is invalid, skip output: ${key}=${value}`);
      return;
    }
    filePath = outputFile;
  }
  fs.appendFileSync(filePath, `${key}=${value}\n`, 'utf-8');
  console.log(`[OUTPUT] ${key}=${value}`);
}

/**
 * 在 root 下查找 .git 目录，返回首个命中的 .git 路径（无则 null）。
 * 等价于 `find <root> -maxdepth 3 -type d -name ".git"`，改用 Node fs 递归实现，
 * workspace 路径不再拼入 shell 命令（Ref issue #16/#20 命令注入整改）。
 */
function findGitDir(root, maxDepth = 3) {
  let dirs = [root];
  for (let depth = 0; depth < maxDepth && dirs.length > 0; depth++) {
    const next = [];
    for (const dir of dirs) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        if (entry.name === '.git') return full;
        next.push(full);
      }
    }
    dirs = next;
  }
  return null;
}

/** 解析仓库根目录：优先取 workspace 下 git 仓库根，兜底 workspace 本身 */
function resolveRepoRoot(workspace) {
  const gitDir = findGitDir(workspace);
  if (gitDir) {
    console.log(`[INFO] 仓库根目录（git 根）: ${path.dirname(gitDir)}`);
    return path.dirname(gitDir);
  }
  console.log(`[INFO] 仓库根目录（兜底 workspace）: ${workspace}`);
  return workspace;
}

/** 读取 GitHub 事件负载（GITHUB_EVENT_PATH），读取或解析失败返回 null */
function readGithubEventPayload(env) {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * GitHub 提交 SHA：PR 事件与 GitCode MR 一致按源分支归属，commitId 取
 * pull_request.head.sha（源分支提交），与 GITHUB_HEAD_REF 保持自洽；事件文件缺失时回退 GITHUB_SHA。
 */
function resolveGithubCommitId(env, eventName) {
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const payload = readGithubEventPayload(env);
    const headSha = payload && payload.pull_request && payload.pull_request.head
      ? payload.pull_request.head.sha
      : '';
    if (headSha) return headSha;
    console.log('[WARN] 未能从 GITHUB_EVENT_PATH 解析 pull_request.head.sha，commitId 回退 GITHUB_SHA');
  }
  return env.GITHUB_SHA || '';
}

/**
 * 一次性解析平台上下文：仅当 GITHUB_ACTIONS=true 且无 GitCode 关键上下文时按 GitHub 处理，
 * 其余按 GitCode Actions 处理。GitHub 只读 GITHUB_*，GitCode 只读 ATOMGIT_*，不跨平台混用。
 * PR/MR 事件统一按源分支归属数据：GitHub 取 GITHUB_HEAD_REF + pull_request.head.sha，
 * GitCode 取 ATOMGIT_HEAD_REF。
 * 流水线运行编号/名称同样按平台读取：GitHub 取 GITHUB_RUN_NUMBER/GITHUB_WORKFLOW，
 * GitCode 取 ATOMGIT_RUN_NUMBER/ATOMGIT_WORKFLOW；手动触发等无变量场景兜底空串，
 * 后端按未知来源处理。
 */
function resolvePlatformContext(env = process.env) {
  const isGithub = detectPlatform(env) === 'github';
  if (isGithub) {
    const server = (env.GITHUB_SERVER_URL || '').trim().replace(/\/+$/, '');
    const repository = (env.GITHUB_REPOSITORY || '').trim();
    const eventName = (env.GITHUB_EVENT_NAME || '').toLowerCase();
    const isPullRequest = eventName === 'pull_request' || eventName === 'pull_request_target';
    return {
      isGithub,
      gitUrl: server && repository ? `${server}/${repository}` : '',
      branchName: isPullRequest ? (env.GITHUB_HEAD_REF || '') : (env.GITHUB_REF_NAME || ''),
      pipelineRunId: env.GITHUB_RUN_ID || '',
      commitId: resolveGithubCommitId(env, eventName),
      runNumber: env.GITHUB_RUN_NUMBER || '',
      pipelineName: env.GITHUB_WORKFLOW || '',
      repoName: repository.split('/').pop() || 'unknown-repo',
      workspace: env.GITHUB_WORKSPACE || process.cwd(),
    };
  }

  const rawUrl = (env.ATOMGIT_REPOSITORY_URL || '').trim();
  const repository = (env.ATOMGIT_REPOSITORY || env.GIT_REPOSITORY || '').trim();
  const eventName = (env.ATOMGIT_EVENT_NAME || '').toLowerCase();
  return {
    isGithub,
    gitUrl: rawUrl ? rawUrl.replace(/\.git$/, '') : '',
    branchName: eventName === 'mr'
      ? (env.ATOMGIT_HEAD_REF || '')
      : (env.ATOMGIT_REF_NAME || ''),
    pipelineRunId: env.ATOMGIT_RUN_ID || '',
    commitId: env.ATOMGIT_SHA || '',
    runNumber: env.ATOMGIT_RUN_NUMBER || '',
    pipelineName: env.ATOMGIT_WORKFLOW || '',
    repoName: repository.split('/').pop() || 'unknown-repo',
    workspace: env.WORKSPACE || process.cwd(),
  };
}

/**
 * 解析覆盖率报告路径输入：主干永久兼容 v1.0.1 前的旧输入名 report_dir。
 *
 * <p>新名 report_path 优先；仅传旧名时兜底使用并打印弃用警告；两者皆缺返回空串，
 * 由调用方报错并指向新名。
 *
 * @returns {{reportPath: string, usedDeprecatedName: boolean}} 解析后的路径与旧名使用标记
 */
function resolveReportPathInput() {
  const reportPath = getInput('report_path');
  if (reportPath) {
    return { reportPath, usedDeprecatedName: false };
  }
  const legacyReportDir = getInput('report_dir');
  if (legacyReportDir) {
    console.log(
      '[WARN] 输入 report_dir 已重命名为 report_path，将于下个 major 版本移除，请尽快迁移',
    );
    return { reportPath: legacyReportDir, usedDeprecatedName: true };
  }
  return { reportPath: '', usedDeprecatedName: false };
}

function resolveRegion() {
  const fromInput = getInput('region');
  if (fromInput) {
    console.log(`[INFO] 使用 region（input）: ${fromInput}`);
    return fromInput;
  }
  for (const name of REGION_ENV_CANDIDATES) {
    const val = process.env[name];
    if (val && val.trim()) {
      console.log(`[INFO] 使用 region（环境变量 ${name}）: ${val.trim()}`);
      return val.trim();
    }
  }
  console.log('[INFO] 使用 region（默认）: cn-southwest-2');
  return 'cn-southwest-2';
}

// ---------- 主流程 ----------

async function run() {
  const { reportPath } = resolveReportPathInput();
  const envType = (getInput('env_type') || 'prod').toLowerCase();
  const region = resolveRegion();

  const platform = resolvePlatformContext();
  const { gitUrl, branchName, pipelineRunId, commitId, repoName, workspace, runNumber, pipelineName } = platform;

  console.log('===== upload-ut-action 启动 =====');
  console.log(`[INFO] 运行平台: ${platform.isGithub ? 'GitHub Actions' : 'GitCode Actions'}`);
  console.log(`[INFO] 环境类型: ${envType === 'beta' ? 'beta (测试环境)' : 'prod (正式环境)'}`);
  console.log(`[INFO] region: ${region}`);
  console.log(`[INFO] 仓库: ${gitUrl}，分支: ${branchName || '(未识别)'}，流水线: ${pipelineRunId || 'manual'}`);

  if (!reportPath) {
    console.log('[ERROR] 必须配置 report_path（覆盖率报告文件或目录，逗号分隔多值）');
    setOutput('result', 'failed');
    process.exit(1);
  }

  console.log('\n===== [1] 扫描报告 =====');
  const inputs = reportPath.split(',').map((s) => s.trim()).filter(Boolean);
  const reports = ReportScanner.scan(inputs);
  if (reports.length === 0) {
    console.log('[WARN] 未识别到任何覆盖率报告（支持 jacoco.xml / coverage.json / coverage.out / .gcov / lcov / coverage-final.json / llvm-cov export）');
    console.log('[INFO] 常见原因：测试阶段未生成报告，或报告格式不在支持列表内');
    setOutput('result', 'success');
    return;
  }
  reports.forEach((r) => console.log(`  [OK] ${r.tool}: ${r.file}`));

  console.log('\n===== [2] 解析并转换标准 JSON =====');
  const parsedList = [];
  for (const r of reports) {
    const Parser = PARSER_MAP[r.tool];
    if (!Parser) {
      console.log(`[WARN] 缺少解析器: ${r.tool}，跳过 ${r.file}`);
      continue;
    }
    try {
      const parsed = Parser.parseFile(r.file);
      parsedList.push(parsed);
      const m = parsed.metrics || {};
      console.log(`[OK] 解析完成: ${path.basename(r.file)}（lineCoverage=${m.lineCoverage}%, files=${(parsed.files || []).length}）`);
    } catch (e) {
      console.log(`[WARN] 解析失败，跳过 ${r.file}: ${e.message}`);
    }
  }

  if (parsedList.length === 0) {
    console.log('[ERROR] 所有报告解析失败，无有效覆盖率数据');
    setOutput('result', 'failed');
    process.exit(1);
  }

  const repoRoot = resolveRepoRoot(workspace);
  const standardJson =
    CoverageNormalizer.normalize(
      parsedList,
      { gitUrl, branchName, pipelineRunId, commitId, runNumber, pipelineName },
      repoRoot
    );
  console.log(`[OK] 标准 JSON 组装完成: lineCoverage=${standardJson.lineCoverage}%, fileDetails=${standardJson.fileDetails.length}`);
  console.log(`[INFO] 可缺省指标: ${['branchCoverage', 'methodCoverage', 'classCoverage'].filter((k) => standardJson[k] != null).join(', ') || '无'}`);

  console.log('\n===== [3] OIDC 换证 + OBS 上传 + APIG 回调 =====');
  let notifyResult;
  try {
    notifyResult = await ObsUploader.uploadAndNotify(
      standardJson,
      { repoName, pipelineRunId, gitUrl, branchName },
      { envType }
    );
  } catch (err) {
    console.log(`[ERROR] 上传/回调链路失败: ${err.message}`);
    setOutput('result', 'failed');
    process.exit(1);
  }

  // 评审对齐①：上报受理响应直接携带记录ID与结果链接（recordId 受理时预生成），无查询接口、无重试；
  // 旧版后端响应缺字段 / 回调失败 / 仓库定位失败时链接缺省，仅告警不影响流水线结果
  const { recordId, reportUrl } = notifyResult || {};
  if (reportUrl) {
    setOutput('report_url', reportUrl);
    if (recordId) {
      console.log(`[INFO] 记录ID: ${recordId}`);
    }
    console.log(`[OK] 结果链接: ${reportUrl}`);
  } else {
    console.log('[WARN] 回调响应未携带结果链接（旧版后端或仓库定位失败），report_url 缺省输出，不影响流水线结果');
  }

  console.log('\n================================================================');
  console.log('[INFO] UT 覆盖率上报成功');
  console.log('================================================================');
  setOutput('result', 'success');
}

module.exports = { run, findGitDir, resolveRepoRoot, resolvePlatformContext, setOutput, resolveReportPathInput };

if (require.main === module) {
  run().catch((err) => {
    console.error(`Action 执行失败: ${err.message}`);
    setOutput('result', 'failed');
    process.exit(1);
  });
}
