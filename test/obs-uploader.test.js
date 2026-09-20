'use strict';

const test = require('node:test');
const assert = require('node:assert');

const ObsUploader = require('../src/obs/ObsUploader');

test('buildObsKey 构建标准 OBS 路径', () => {
  const key = ObsUploader.buildObsKey('my-repo', 'run-123', new Date(2026, 8, 19, 14, 30));
  assert.strictEqual(key, 'ut-coverage-action/my-repo/20260919.14/run-123/ut-coverage.json');
});

test('buildObsKey 仓库名清洗非法字符', () => {
  const key = ObsUploader.buildObsKey('My_Repo!!!', '', new Date(2026, 8, 19, 8, 0));
  assert.strictEqual(key, 'ut-coverage-action/My_Repo/20260919.08/manual/ut-coverage.json');
});

test('buildObsKey runId 缺失用 manual', () => {
  const key = ObsUploader.buildObsKey('r', '', new Date(2026, 0, 1, 0, 0));
  assert.strictEqual(key, 'ut-coverage-action/r/20260101.00/manual/ut-coverage.json');
});

test('回调路径前缀与常量正确', () => {
  assert.strictEqual(ObsUploader.OIDC_API_PREFIX, '/action-api');
  assert.strictEqual(ObsUploader.CALLBACK_PATH, '/ut/coverage/report');
  assert.strictEqual(ObsUploader.OBS_PREFIX, 'ut-coverage-action');
});
