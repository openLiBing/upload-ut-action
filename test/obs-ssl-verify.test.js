'use strict';

const test = require('node:test');
const assert = require('node:assert');

// ============ 在加载业务模块前劫持 require.cache 注入 SDK mock ============
// ObsUploader.js 在模块加载期 require 真实 esdk-obs-nodejs，mock 必须先注入

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

// ============ ObsClient 构造使用 SDK 原生键名 ssl_verify（P1 回归） ============

const ObsUploader = require('../src/obs/ObsUploader');

const CRED = { accessKeyId: 'a', secretAccessKey: 'b', securityToken: 'c' };

test('ObsClient 构造使用 SDK 原生键名 ssl_verify（P1：sslVerify 被忽略回归）', async () => {
  await ObsUploader.uploadJson({}, 'k3', CRED, 'private');
  assert.strictEqual(recorded.constructorArgs.ssl_verify, true);
  assert.strictEqual(recorded.constructorArgs.sslVerify, undefined);
});
