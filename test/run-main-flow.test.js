'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ============ 在加载业务模块前劫持 require.cache 注入 SDK mock ============
// ObsUploader.js 在模块加载期 require 真实 esdk-obs-nodejs，mock 必须先注入
// （与 obs-ssl-verify.test.js 同款范式）

class FakeObsClient {
  constructor() {}
  putObject() {
    return Promise.resolve({ CommonMsg: { Status: 200 } });
  }
  close() {
    return Promise.resolve();
  }
}

const obsSdkId = require.resolve('esdk-obs-nodejs');
require.cache[obsSdkId] = {
  id: obsSdkId,
  filename: obsSdkId,
  path: obsSdkId,
  loaded: true,
  exports: FakeObsClient,
  children: [],
};

const ObsUploader = require('../src/obs/ObsUploader');

// run() 主流程的 uploadAndNotify 替换为捕获桩：单测不外呼 OBS/OIDC/APIG，
// 同时捕获标准 JSON 与上报元数据，断言流水线编号/名称贯通链路与结果链接输出
const captured = [];
const realUploadAndNotify = ObsUploader.uploadAndNotify;
ObsUploader.uploadAndNotify = async (standardJson, meta, opts) => {
  captured.push({ standardJson, meta, opts });
};

// index.js 的 run 等导出在模块加载期绑定，require 放在 mock 注入之后
const { run } = require('../index');

/** run() 依赖的环境变量全集：断言前逐一清空，避免宿主/CI 环境串扰（含 runner 注入变量）。 */
const ENV_KEYS = [
  'INPUT_REPORT_PATH',
  'INPUT_ENV_TYPE',
  'ATOMGIT_REPOSITORY_URL',
  'ATOMGIT_EVENT_NAME',
  'ATOMGIT_HEAD_REF',
  'ATOMGIT_REF_NAME',
  'ATOMGIT_RUN_ID',
  'ATOMGIT_RUN_NUMBER',
  'ATOMGIT_WORKFLOW',
  'ATOMGIT_SHA',
  'ATOMGIT_REPOSITORY',
  'WORKSPACE',
  // GitCode runner 会向 step 注入输出文件路径与 GITHUB_* 兼容变量，
  // 不清掉会让 setOutput 按 ATOMGIT_OUTPUT 优先级写到别处 / 误判平台
  'ATOMGIT_OUTPUT',
  'GITHUB_OUTPUT',
  'GITHUB_ACTIONS',
  'STEP_OUTPUT',
  'CLOUD_REGION',
  'CLOUD_REGION_ID',
  'REGION_ID',
  'HUAWEICLOUD_REGION',
];

/**
 * 在隔离环境下执行 run()。
 *
 * @param {Object} options 执行选项
 * @param {Object} [options.uploadResult] 注入的 uploadAndNotify 桩返回值（undefined 保持默认桩无返回）
 * @param {Object} [options.env] 额外/覆盖的环境变量
 * @returns {Promise<{output: string, captured: Array}>} STEP_OUTPUT 文件内容与捕获到的调用
 */
async function runAction({ uploadResult, env = {} } = {}) {
  const stepOutput = path.join(os.tmpdir(), `ut-step-output-${process.pid}-${Date.now()}.txt`);
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ObsUploader.uploadAndNotify = async (standardJson, meta, opts) => {
    captured.push({ standardJson, meta, opts });
    return uploadResult;
  };
  try {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    process.env.INPUT_REPORT_PATH = path.join(__dirname, 'fixtures', 'coverage.json');
    process.env.ATOMGIT_REPOSITORY_URL = 'https://gitcode.com/openlibing/upload-ut-action.git';
    process.env.ATOMGIT_EVENT_NAME = 'mr';
    process.env.ATOMGIT_HEAD_REF = 'feat-ut-pipeline-metadata';
    process.env.ATOMGIT_RUN_ID = 'run-123';
    process.env.ATOMGIT_RUN_NUMBER = '42';
    process.env.ATOMGIT_WORKFLOW = 'ut-coverage';
    process.env.ATOMGIT_SHA = 'abc123def';
    process.env.ATOMGIT_REPOSITORY = 'openlibing/upload-ut-action';
    process.env.STEP_OUTPUT = stepOutput;
    Object.entries(env).forEach(([k, v]) => {
      process.env[k] = v;
    });

    captured.length = 0;
    await run();
    return { output: fs.readFileSync(stepOutput, 'utf-8'), captured };
  } finally {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    });
    fs.rmSync(stepOutput, { force: true });
    ObsUploader.uploadAndNotify = realUploadAndNotify;
  }
}

test('run() 主流程贯通流水线元数据：编号/名称读自环境变量并写入标准 JSON 与上报元数据', async () => {
  const { output, captured: calls } = await runAction();

  assert.strictEqual(calls.length, 1, 'uploadAndNotify 应被调用一次');
  const { standardJson, meta } = calls[0];
  // 流水线编号/名称/SHA 原样进入标准 JSON（插件上下文注入，手动触发等无变量场景兜底空串）
  assert.strictEqual(standardJson.pipelineRunId, 'run-123');
  assert.strictEqual(standardJson.runNumber, '42');
  assert.strictEqual(standardJson.pipelineName, 'ut-coverage');
  assert.strictEqual(standardJson.commitId, 'abc123def');
  // normalize 元数据透传：repoUrl 去 .git、MR 事件分支名取 ATOMGIT_HEAD_REF
  assert.strictEqual(meta.pipelineRunId, 'run-123');
  assert.strictEqual(meta.gitUrl, 'https://gitcode.com/openlibing/upload-ut-action');
  assert.strictEqual(meta.branchName, 'feat-ut-pipeline-metadata');
  assert.strictEqual(meta.repoName, 'upload-ut-action');
  // 主流程成功收尾：result=success 写入 STEP_OUTPUT
  assert.ok(output.includes('result=success'), `STEP_OUTPUT 应包含 result=success，实际: ${output}`);
});

test('run() 受理响应携带结果链接：report_url/记录ID 写入 step 输出且不影响 result=success（评审对齐①）', async () => {
  const { output } = await runAction({
    uploadResult: {
      obsUrl: 'https://bucket.obs.example.com/ut-coverage-action/a/ut-coverage.json',
      recordId: '1926534123456789',
      reportUrl: 'https://www.openlibing.com/apps/repos?projectId=403256&repoId=823&branchName=feat-ut-pipeline-metadata&recordId=1926534123456789&utCoverageDetail=1',
    },
  });

  assert.ok(
    output.includes(
      'report_url=https://www.openlibing.com/apps/repos?projectId=403256&repoId=823&branchName=feat-ut-pipeline-metadata&recordId=1926534123456789&utCoverageDetail=1',
    ),
    `STEP_OUTPUT 应包含 report_url，实际: ${output}`,
  );
  assert.ok(output.includes('result=success'), `携带链接时流水线结果仍应为 success，实际: ${output}`);
});

test('run() 受理响应缺结果链接（旧版后端）：仅告警降级，不输出 report_url 且 result 仍为 success', async () => {
  const { output } = await runAction({ uploadResult: { obsUrl: 'https://bucket.obs.example.com/a.json' } });

  assert.ok(!output.includes('report_url='), `旧版后端不应输出 report_url，实际: ${output}`);
  assert.ok(output.includes('result=success'), `链接缺失不影响 result=success，实际: ${output}`);
});
