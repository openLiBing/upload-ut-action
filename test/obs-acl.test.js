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

// ============ Part 1：index.js 不再读取 obs_acl 输入 ============

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

test('残留 obs_acl 输入不影响运行（参数已移除）', async () => {
  process.env.INPUT_OBS_ACL = 'authenticated-read';
  process.env.INPUT_REPORT_DIR = 'definitely-not-exists-path';
  await run(); // 无报告 → 正常返回，不因 obs_acl 抛错
});

test('未设置 obs_acl 正常运行', async () => {
  delete process.env.INPUT_OBS_ACL;
  process.env.INPUT_REPORT_DIR = 'definitely-not-exists-path';
  await run();
});

// ============ Part 2：OBS 对象固定私有（不设置 ACL） ============

const ObsUploader = require('../src/obs/ObsUploader');

const CRED = { accessKeyId: 'a', secretAccessKey: 'b', securityToken: 'c' };

test('uploadJson 不设置 ACL（私有对象）', async () => {
  recorded.putObjectArgs.length = 0;
  await ObsUploader.uploadJson({}, 'k1', CRED);
  assert.strictEqual(recorded.putObjectArgs.length, 1);
  assert.strictEqual(recorded.putObjectArgs[0].ACL, undefined);
});

test('uploadAndNotify 全链路不设置 ACL', async () => {
  recorded.putObjectArgs.length = 0;
  const res = await ObsUploader.uploadAndNotify(
    { lineCoverage: 50 },
    { repoName: 'r', pipelineRunId: 'run-1', gitUrl: '', branchName: '' },
    { envType: 'prod' }
  );
  assert.ok(res.obsUrl.includes('ut-coverage.json'));
  assert.strictEqual(recorded.putObjectArgs.length, 1);
  assert.strictEqual(recorded.putObjectArgs[0].ACL, undefined);
});

test('调用方传入 obsAcl 也不会再设置 ACL', async () => {
  recorded.putObjectArgs.length = 0;
  await ObsUploader.uploadAndNotify(
    { lineCoverage: 50 },
    { repoName: 'r', pipelineRunId: 'run-2', gitUrl: '', branchName: '' },
    { envType: 'prod', obsAcl: 'public-read' }
  );
  assert.strictEqual(recorded.putObjectArgs[0].ACL, undefined);
});
