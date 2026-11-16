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
// 同时捕获标准 JSON 与上报元数据，断言流水线编号/名称贯通链路
const captured = [];
const realUploadAndNotify = ObsUploader.uploadAndNotify;
ObsUploader.uploadAndNotify = async (standardJson, meta, opts) => {
  captured.push({ standardJson, meta, opts });
};

// index.js 的 run 等导出在模块加载期绑定，require 放在 mock 注入之后
const { run } = require('../index');

test('run() 主流程贯通流水线元数据：编号/名称读自环境变量并写入标准 JSON 与上报元数据', async () => {
  const stepOutput = path.join(os.tmpdir(), `ut-step-output-${process.pid}.txt`);
  const envKeys = [
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
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  try {
    envKeys.forEach((k) => delete process.env[k]);
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

    captured.length = 0;
    await run();

    assert.strictEqual(captured.length, 1, 'uploadAndNotify 应被调用一次');
    const { standardJson, meta } = captured[0];
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
    const output = fs.readFileSync(stepOutput, 'utf-8');
    assert.ok(output.includes('result=success'), `STEP_OUTPUT 应包含 result=success，实际: ${output}`);
  } finally {
    envKeys.forEach((k) => {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    });
    fs.rmSync(stepOutput, { force: true });
    ObsUploader.uploadAndNotify = realUploadAndNotify;
  }
});
