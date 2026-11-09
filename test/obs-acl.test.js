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

// ============ Part 1：index.js / action.yml 不再有 obs_acl 输入 ============

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

test('index.js 不再读取 obs_acl 输入', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'index.js'), 'utf8');
  assert.ok(!/obs_acl/i.test(src), 'index.js 不应残留 obs_acl 逻辑');
});

test('action.yml 不再声明 obs_acl 输入', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'action.yml'), 'utf8');
  assert.ok(!/obs_acl/i.test(src), 'action.yml 不应声明 obs_acl 输入');
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
