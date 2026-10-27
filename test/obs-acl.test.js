'use strict';

const test = require('node:test');
const assert = require('node:assert');

// ============ Part 0：在加载任何业务模块前劫持 require.cache 注入 SDK mock ============
// index.js / ObsUploader.js 在模块加载期 require 真实 SDK，mock 必须先于 require('../index')

const recorded = { constructorArgs: null, putObjectArgs: [], closeCount: 0 };

class FakeObsClient {
  constructor(args) {
    recorded.constructorArgs = args;
  }
  putObject(args) {
    recorded.putObjectArgs.push(args);
    return Promise.resolve({ CommonMsg: { Status: 200 } });
  }
  close() {
    recorded.closeCount++;
    return Promise.resolve();
  }
}

const obsSdkId = require.resolve('esdk-obs-nodejs');
require.cache[obsSdkId] = {
  id: obsSdkId, filename: obsSdkId, path: obsSdkId, loaded: true,
  exports: FakeObsClient, children: [],
};

const oidcId = require.resolve('@openlibing/huaweicloud-oidc-client');
const fakeOidc = {
  V11Signer: class { sign() { return {}; } },
  sendRequest: async () => ({ status: 200, data: { code: 200 } }),
  getCredentials: async () => ({ accessKeyId: 'AK-test', secretAccessKey: 'SK-test', securityToken: 'ST-test' }),
  configure: () => ({ region: 'cn-southwest-2' }),
};
require.cache[oidcId] = {
  id: oidcId, filename: oidcId, path: oidcId, loaded: true,
  exports: fakeOidc, children: [],
};

// ============ Part 1：index.js obs_acl 白名单（P0 回归） ============

const { run } = require('../index');

const ENV_KEYS = ['INPUT_OBS_ACL', 'INPUT_REPORT_DIR', 'WORKSPACE'];
const savedEnv = {};

test.before(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

test.after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('obs_acl 非法值提前抛错（P0：obsAcl 未定义回归）', async () => {
  process.env.INPUT_OBS_ACL = 'authenticated-read';
  process.env.INPUT_REPORT_DIR = '';
  await assert.rejects(run(), (err) => err.message.includes('obs_acl 参数非法') && err.message.includes('authenticated-read'));
});

test('obs_acl 空值缺省 public-read 不抛错', async () => {
  process.env.INPUT_OBS_ACL = '';
  process.env.INPUT_REPORT_DIR = 'definitely-not-exists-path';
  await run(); // 无报告 → 正常返回，不 exit
});

test('obs_acl=private 合法值通过白名单', async () => {
  process.env.INPUT_OBS_ACL = 'private';
  process.env.INPUT_REPORT_DIR = 'definitely-not-exists-path';
  await run();
});

test('obs_acl 大小写不敏感（PUBLIC-READ 归一化）', async () => {
  process.env.INPUT_OBS_ACL = 'PUBLIC-READ';
  process.env.INPUT_REPORT_DIR = 'definitely-not-exists-path';
  await run();
});

// ============ Part 2：ObsUploader ACL 透传 + ssl_verify 键名（P1 回归） ============

const ObsUploader = require('../src/obs/ObsUploader');

const CRED = { accessKeyId: 'a', secretAccessKey: 'b', securityToken: 'c' };

test('uploadJson 透传 acl=private 到 putObject（P1：写死 public-read 回归）', async () => {
  await ObsUploader.uploadJson({}, 'k1', CRED, 'private');
  assert.strictEqual(recorded.putObjectArgs.length, 1);
  assert.strictEqual(recorded.putObjectArgs[0].ACL, 'private');
});

test('uploadJson 缺省 acl 保持 public-read（行为等价）', async () => {
  recorded.putObjectArgs.length = 0;
  await ObsUploader.uploadJson({}, 'k2', CRED);
  assert.strictEqual(recorded.putObjectArgs[0].ACL, 'public-read');
});

test('ObsClient 构造使用 SDK 原生键名 ssl_verify（P1：sslVerify 被忽略回归）', async () => {
  await ObsUploader.uploadJson({}, 'k3', CRED, 'private');
  assert.strictEqual(recorded.constructorArgs.ssl_verify, true);
  assert.strictEqual(recorded.constructorArgs.sslVerify, undefined);
});

test('uploadAndNotify 透传 obsAcl=private 全链路到 OBS（P0/P1 闭环）', async () => {
  recorded.putObjectArgs.length = 0;
  const res = await ObsUploader.uploadAndNotify(
    { lineCoverage: 50 },
    { repoName: 'r', pipelineRunId: 'run-1', gitUrl: '', branchName: '' },
    { envType: 'prod', obsAcl: 'private' }
  );
  assert.ok(res.obsUrl.includes('ut-coverage.json'));
  assert.strictEqual(recorded.putObjectArgs.length, 1);
  assert.strictEqual(recorded.putObjectArgs[0].ACL, 'private');
});

test('uploadAndNotify 缺省 obsAcl 保持 public-read（行为等价）', async () => {
  recorded.putObjectArgs.length = 0;
  await ObsUploader.uploadAndNotify(
    { lineCoverage: 50 },
    { repoName: 'r', pipelineRunId: 'run-2', gitUrl: '', branchName: '' },
    { envType: 'prod' }
  );
  assert.strictEqual(recorded.putObjectArgs[0].ACL, 'public-read');
});
