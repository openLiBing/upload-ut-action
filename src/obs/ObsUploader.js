'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ObsClient = require('esdk-obs-nodejs');

/**
 * OBS 上传 + APIG 回调（OIDC 免静态凭证）。
 *
 * 链路：OIDC ID Token 自申请 → 华为云 STS 换临时 AK/SK/SecurityToken →
 *       OBS putObject（私有对象，不设置 ACL；后端按 objectKey 带平台凭证下载）→ APIG V11 签名回调。
 * OBS 上传与 APIG 回调均指数退避重试（默认 3 次）。
 */

let V11Signer = null;
let sendRequest = null;
let getCredentials = null;
let configure = null;
try {
  ({ V11Signer, sendRequest, getCredentials, configure } = require('@openlibing/huaweicloud-oidc-client'));
} catch (e) {
  console.log('[ERROR] @openlibing/huaweicloud-oidc-client 加载失败，请重新构建 dist 后重试');
}

// ---------- 常量 ----------

const APIG_SIGN_REGION = 'cn-southwest-2'; // APIG V11 签名区域
const OIDC_API_PREFIX = '/action-api'; // OIDC 回调路径前缀（网关 IAM 认证）
const CALLBACK_PATH = '/ut/coverage/report'; // coderepo UtCoverageController.reportUtCoverage
// Ref issue #2：OIDC 业务 API 基址支持环境变量注入（OPENLIBING_APIG_PROD_BASE /
// OPENLIBING_APIG_BETA_BASE），默认值仅为功能必需回退（公司 OpenLibing 平台
// APIG 域名），已登记白名单作为合规例外，不得删除或替换
const OIDC_PROD_BASE = process.env.OPENLIBING_APIG_PROD_BASE || 'https://apig.openlibing.com'; // gitleaks:allow 功能必需的业务 API 默认回退地址，运行时优先环境变量注入
// beta 环境回调基址：统一业务域名 beta.apig.openlibing.com 证书链未修复（TLS 校验失败），临时回退 APIG 默认域名
const OIDC_BETA_BASE = process.env.OPENLIBING_APIG_BETA_BASE || 'https://174e1b821a8446f38998a67186ba766e.apic.cn-southwest-2.huaweicloudapis.com'; // gitleaks:allow 功能必需的业务 API 默认回退地址（beta），运行时优先环境变量注入

const OBS_BUCKET = 'openlibing-gitcode-action';
const OBS_READ_ENDPOINT = 'https://openlibing-gitcode-action.obs.cn-southwest-2.myhuaweicloud.com';
const OBS_PREFIX = 'ut-coverage-action';
const OBS_OBJECT_NAME = 'ut-coverage.json';

// ---------- 通用辅助 ----------

/** 同步指数退避重试：默认 3 次，失败后 sleep(2^(n-1) 秒) 再试 */
function withRetrySync(fn, { retries = 3, label = '' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delaySec = Math.pow(2, attempt - 1);
      console.log(`[WARN] ${label} 第 ${attempt} 次失败（${err.message}），${delaySec}s 后重试（${attempt + 1}/${retries}）`);
      const { execSync } = require('child_process');
      try {
        execSync(`sleep ${delaySec}`, { shell: '/bin/bash' });
      } catch (e) {
        // sleep 命令不可用时兜底 JS 等待
      }
    }
  }
  throw lastErr;
}

/** 异步指数退避重试：默认 3 次，失败后延迟 2^(n-1) 秒再试 */
async function withRetryAsync(fn, { retries = 3, label = '' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      console.log(`[WARN] ${label} 第 ${attempt} 次失败（${err.message}），${delayMs}ms 后重试（${attempt + 1}/${retries}）`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/** 对象 Key 段清洗：仅保留字母数字与 . _ -，其余折叠为单连字符，空结果回退默认值 */
function sanitizeKeySegment(value, fallback) {
  const s = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

/** 构建 OBS 对象 Key：ut-coverage-action/{repoName}/{yyyyMMdd}.{HH}/{runId|manual}/ut-coverage.json */
function buildObsKey(repoName, runId, date = new Date()) {
  const name = sanitizeKeySegment(repoName, 'unknown-repo');
  const rid = sanitizeKeySegment(runId, 'manual');
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}.${String(date.getHours()).padStart(2, '0')}`;
  return `${OBS_PREFIX}/${name}/${dateStr}/${rid}/${OBS_OBJECT_NAME}`;
}

/** OIDC 换证：返回 { accessKeyId, secretAccessKey, securityToken } */
async function getOidcCredentials() {
  if (!getCredentials) throw new Error('@openlibing/huaweicloud-oidc-client 未加载，无法 OIDC 换证');
  const cred = await getCredentials();
  if (!cred || !cred.accessKeyId || !cred.secretAccessKey) {
    throw new Error('OIDC 换证结果缺少 AK/SK');
  }
  return cred;
}

/** OBS 上传（私有对象 + 指数退避重试），返回对象 URL */
async function uploadJson(standardJson, key, cred) {
  if (!configure || !ObsClient) throw new Error('OBS SDK 未加载，无法上传');
  const { region } = configure({});
  const server = `https://obs.${region}.myhuaweicloud.com`;
  // esdk-obs-nodejs initFactory 为 fire-and-forget，构造后让出一个微任务等待签名上下文初始化
  const client = new ObsClient({
    access_key_id: cred.accessKeyId,
    secret_access_key: cred.secretAccessKey,
    security_token: cred.securityToken,
    server,
    // esdk-obs-nodejs 默认关闭 TLS 证书校验（Ref #8/#14），显式恢复校验。
    // SDK 构造参数键名为 ssl_verify（initFactory 读取 param.ssl_verify），
    // 误写 sslVerify 会被忽略（上一轮整改回归缺陷，本处修正）
    ssl_verify: true,
  });
  await Promise.resolve();

  const tmpDir = os.tmpdir();
  // 随机后缀避免可预测临时文件名（Ref #5）：同毫秒并发/共享 tmpdir 下不可被抢注或预读
  const tmpFile = path.join(tmpDir, `ut-coverage-${Date.now()}-${crypto.randomUUID()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(standardJson, null, 2), 'utf-8');

  try {
    const assertOk = (result) => {
      const msg = (result && result.CommonMsg) || {};
      if (!(msg.Status >= 200 && msg.Status < 300)) {
        throw new Error(`OBS 上传失败 (${msg.Status})${msg.Code ? ' [' + msg.Code + ']' : ''}: ${msg.Message || '未知错误'}`);
      }
    };
    await withRetryAsync(
      // 私有对象（不设置 ACL）；后端按 objectKey 用平台 OBS 凭证下载（Ref #1 #4 #15 #18 #21）
      () => client.putObject({ Bucket: OBS_BUCKET, Key: key, SourceFile: tmpFile }).then(assertOk),
      { label: `OBS 上传 ${key}` }
    );
    return `${OBS_READ_ENDPOINT}/${key}`;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (e) {
      // 临时文件清理失败不影响结果
    }
    await client.close();
  }
}

/** APIG V11 签名回调（OIDC 临时凭证 + X-Security-Token），失败抛错供重试 */
async function sendCallbackOidc(url, payload, cred) {
  if (!V11Signer || !sendRequest) {
    throw new Error('@openlibing/huaweicloud-oidc-client 未加载，无法进行 OIDC 回调');
  }
  const signer = new V11Signer({ region: APIG_SIGN_REGION });
  signer.Key = cred.accessKeyId;
  signer.Secret = cred.secretAccessKey;
  const headers = { 'Content-Type': 'application/json' };
  if (cred.securityToken) headers['X-Security-Token'] = cred.securityToken;

  const body = JSON.stringify(payload);
  const signedHeaders = signer.sign('POST', url, headers, body);
  const res = await sendRequest('POST', url, signedHeaders, body);

  const data = res.data;
  if (res.status < 200 || res.status >= 300) {
    throw new Error((data && (data.msg || data.message || data.error_msg)) || `HTTP ${res.status}`);
  }
  if (data && (data.code === 200 || data.code === 0)) {
    return data;
  }
  throw new Error(`API 业务错误: code=${data && data.code}, msg=${data && (data.msg || data.message) || 'unknown'}`);
}

/**
 * 执行完整上报：换证 → 上传 OBS → 回调 APIG。
 * @param {Object} standardJson 标准上报 JSON
 * @param {{repoName: string, pipelineRunId: string, gitUrl: string, branchName: string}} opts
 * @param {{envType: string}} opts2 环境类型
 * @returns {Promise<{obsUrl: string}>}
 */
async function uploadAndNotify(standardJson, opts, { envType = 'prod' } = {}) {
  const isBeta = String(envType || 'prod').toLowerCase() === 'beta';
  const callbackBase = isBeta ? OIDC_BETA_BASE : OIDC_PROD_BASE;

  console.log(`[INFO] 认证模式: OIDC 联邦认证（SDK 自包含换证）`);
  console.log(`[INFO] 回调地址: ${callbackBase}${OIDC_API_PREFIX}${CALLBACK_PATH}`);
  console.log('[INFO] OBS 对象 ACL: 私有（不设置 ACL，后端按 objectKey 带凭证下载）');

  // 1. OIDC 换证
  const cred = await getOidcCredentials();
  console.log('[OK] 临时凭证获取成功（OIDC ID Token 自申请 + STS 换证）');

  // 2. 上传 OBS
  const key = buildObsKey(opts.repoName, opts.pipelineRunId);
  console.log(`[INFO] OBS 路径: obs://${OBS_BUCKET}/${key}`);
  const obsUrl = await uploadJson(standardJson, key, cred);
  console.log(`[OK] OBS 上传成功: ${obsUrl}`);

  // 3. 回调 APIG（回调失败不阻断：OBS 已上传，数据可后续补导入）
  const callbackPayload = {
    gitUrl: opts.gitUrl || '',
    branchName: opts.branchName || '',
    pipelineRunId: opts.pipelineRunId || '',
    obsUrl,
  };
  const callbackUrl = `${callbackBase}${OIDC_API_PREFIX}${CALLBACK_PATH}`;
  try {
    const callbackResult = await withRetryAsync(
      () => sendCallbackOidc(callbackUrl, callbackPayload, cred),
      { label: 'APIG 回调' }
    );
    console.log(`[OK] 回调通知发送成功，回调时间: ${new Date().toISOString()}`);
    console.log(`[INFO] 回调响应: ${JSON.stringify(callbackResult)}`);
  } catch (err) {
    console.log(`[WARN] 回调通知发送失败: ${err.message}`);
    console.log('[INFO] OBS 上传已成功，回调失败不影响数据留存');
  }

  return { obsUrl };
}

module.exports = {
  uploadAndNotify,
  buildObsKey,
  getOidcCredentials,
  uploadJson,
  sendCallbackOidc,
  withRetrySync,
  withRetryAsync,
  OBS_BUCKET,
  OBS_PREFIX,
  OBS_READ_ENDPOINT,
  CALLBACK_PATH,
  OIDC_API_PREFIX,
};
