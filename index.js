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

function setOutput(key, value) {
  const stepOutput = process.env.STEP_OUTPUT;
  if (!stepOutput) {
    console.log(`[WARN] STEP_OUTPUT env not set, skip output: ${key}=${value}`);
    return;
  }
  let filePath;
  try {
    filePath = fs.statSync(stepOutput).isDirectory() ? path.join(stepOutput, 'output') : stepOutput;
  } catch (e) {
    const parentDir = path.dirname(stepOutput);
    if (!(fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory())) {
      console.log(`[WARN] STEP_OUTPUT path is invalid, skip output: ${key}=${value}`);
      return;
    }
    filePath = stepOutput;
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

/** 回调分支：MR 事件用目标分支（ATOMGIT_HEAD_REF），其他事件用当前 ref */
function resolveBranch() {
  const eventName = (process.env.ATOMGIT_EVENT_NAME || '').toLowerCase();
  return eventName === 'mr'
    ? (process.env.ATOMGIT_HEAD_REF || '')
    : (process.env.ATOMGIT_REF_NAME || '');
}

/** 构造仓库 URL（去掉 .git 后缀） */
function resolveGitUrl() {
  const raw = (process.env.ATOMGIT_REPOSITORY_URL || '').trim();
  return raw ? raw.replace(/\.git$/, '') : '';
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
  const reportPath = getInput('report_path');
  const envType = (getInput('env_type') || 'prod').toLowerCase();
  const region = resolveRegion();

  const gitUrl = resolveGitUrl();
  const branchName = resolveBranch();
  const pipelineRunId = process.env.ATOMGIT_RUN_ID || '';
  const commitId = process.env.ATOMGIT_SHA || '';
  const workspace = process.env.WORKSPACE || process.cwd();

  console.log('===== upload-ut-action 启动 =====');
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
  const standardJson = CoverageNormalizer.normalize(parsedList, { gitUrl, branchName, pipelineRunId, commitId }, repoRoot);
  console.log(`[OK] 标准 JSON 组装完成: lineCoverage=${standardJson.lineCoverage}%, fileDetails=${standardJson.fileDetails.length}`);
  console.log(`[INFO] 可缺省指标: ${['branchCoverage', 'methodCoverage', 'classCoverage'].filter((k) => standardJson[k] != null).join(', ') || '无'}`);

  console.log('\n===== [3] OIDC 换证 + OBS 上传 + APIG 回调 =====');
  const repoName = (process.env.ATOMGIT_REPOSITORY || process.env.GIT_REPOSITORY || '').split('/').pop() || 'unknown-repo';
  try {
    await ObsUploader.uploadAndNotify(
      standardJson,
      { repoName, pipelineRunId, gitUrl, branchName },
      { envType }
    );
  } catch (err) {
    console.log(`[ERROR] 上传/回调链路失败: ${err.message}`);
    setOutput('result', 'failed');
    process.exit(1);
  }

  console.log('\n================================================================');
  console.log('[INFO] UT 覆盖率上报成功');
  console.log('================================================================');
  setOutput('result', 'success');
}

module.exports = { run, findGitDir, resolveRepoRoot };

if (require.main === module) {
  run().catch((err) => {
    console.error(`Action 执行失败: ${err.message}`);
    setOutput('result', 'failed');
    process.exit(1);
  });
}
