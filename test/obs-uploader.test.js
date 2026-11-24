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

test('buildObsKey runId 清洗非法字符（Ref #11）', () => {
  const key = ObsUploader.buildObsKey('r', 'run/../x y?z', new Date(2026, 0, 1, 0, 0));
  assert.strictEqual(key, 'ut-coverage-action/r/20260101.00/run-..-x-y-z/ut-coverage.json');
});

test('buildObsKey runId 全非法字符回退 manual（Ref #11）', () => {
  const key = ObsUploader.buildObsKey('r', '///', new Date(2026, 0, 1, 0, 0));
  assert.strictEqual(key, 'ut-coverage-action/r/20260101.00/manual/ut-coverage.json');
});

test('回调路径前缀与常量正确', () => {
  assert.strictEqual(ObsUploader.OIDC_API_PREFIX, '/action-api');
  assert.strictEqual(ObsUploader.CALLBACK_PATH, '/ut/coverage/report');
  assert.strictEqual(ObsUploader.OBS_PREFIX, 'ut-coverage-action');
});

test('selectObsBucket 按平台选择隔离桶', () => {
  assert.strictEqual(ObsUploader.selectObsBucket(true), 'openlibing-github-action');
  assert.strictEqual(ObsUploader.selectObsBucket(false), 'openlibing-gitcode-action');
});

test('OBS 读地址与选中桶名一致', () => {
  assert.strictEqual(
    ObsUploader.OBS_READ_ENDPOINT,
    `https://${ObsUploader.OBS_BUCKET}.obs.cn-southwest-2.myhuaweicloud.com`
  );
});

test('pickAcceptance 提取受理响应 data 携带的 recordId/reportUrl', () => {
  const acceptance = ObsUploader.pickAcceptance({
    code: 200,
    data: { recordId: '42', reportUrl: 'https://web/apps/repos?recordId=42' },
  });
  assert.strictEqual(acceptance.recordId, '42');
  assert.strictEqual(acceptance.reportUrl, 'https://web/apps/repos?recordId=42');
});

test('pickAcceptance 响应缺 data 字段返回空对象（旧版后端兼容）', () => {
  const acceptance = ObsUploader.pickAcceptance({ code: 200 });
  assert.deepStrictEqual(acceptance, {});
  assert.strictEqual(acceptance.recordId, undefined);
  assert.strictEqual(acceptance.reportUrl, undefined);
});

test('pickAcceptance 回调失败无响应对象返回空对象（catch 通道同口径）', () => {
  // uploadAndNotify 的 catch 分支 callbackResult 保持 null，取值同样收口到 pickAcceptance
  const acceptance = ObsUploader.pickAcceptance(null);
  assert.deepStrictEqual(acceptance, {});
  assert.strictEqual(acceptance.recordId, undefined);
  assert.strictEqual(acceptance.reportUrl, undefined);
});
