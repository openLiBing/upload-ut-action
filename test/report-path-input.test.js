'use strict';

const test = require('node:test');
const assert = require('node:assert');

// ============ 在加载业务模块前劫持 require.cache 注入 SDK mock ============
// index.js 模块加载期经 ObsUploader.js require 真实 esdk-obs-nodejs，mock 必须先注入
// （与 obs-ssl-verify.test.js 同款范式）；resolveReportPathInput 本身不触碰上传链路

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

const { resolveReportPathInput } = require('../index');

// 临时替换 console.log 捕获输出（断言弃用警告），结束恢复
function withCapturedConsoleLog(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    return { result: fn(), logs };
  } finally {
    console.log = original;
  }
}

const ENV_KEYS = ['INPUT_REPORT_PATH', 'INPUT_REPORT_DIR'];

test('新名优先：report_path 与 report_dir 同时存在时取新名且不打印弃用警告', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.INPUT_REPORT_PATH = './coverage-new/';
    process.env.INPUT_REPORT_DIR = './coverage-legacy/';
    const { result, logs } = withCapturedConsoleLog(resolveReportPathInput);
    assert.deepStrictEqual(result, {
      reportPath: './coverage-new/',
      usedDeprecatedName: false,
    });
    assert.ok(
      !logs.some((l) => l.includes('[WARN]')),
      '新名生效时不应打印弃用警告',
    );
  } finally {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    });
  }
});

test('仅传旧名 report_dir 时兜底使用并打印弃用警告', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    delete process.env.INPUT_REPORT_PATH;
    process.env.INPUT_REPORT_DIR = './coverage-legacy/';
    const { result, logs } = withCapturedConsoleLog(resolveReportPathInput);
    assert.deepStrictEqual(result, {
      reportPath: './coverage-legacy/',
      usedDeprecatedName: true,
    });
    assert.ok(
      logs.some((l) => l.includes('[WARN]') && l.includes('report_dir')),
      '仅传旧名时应打印 report_dir 弃用警告',
    );
  } finally {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    });
  }
});

test('两者皆缺返回空串，由调用方报错并指向新名', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    const { result, logs } = withCapturedConsoleLog(resolveReportPathInput);
    assert.deepStrictEqual(result, {
      reportPath: '',
      usedDeprecatedName: false,
    });
    assert.ok(!logs.some((l) => l.includes('[WARN]')));
  } finally {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    });
  }
});

test('新名为纯空白视为缺省，旧名兜底生效', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.INPUT_REPORT_PATH = '   ';
    process.env.INPUT_REPORT_DIR = './coverage-legacy/';
    const { result, logs } = withCapturedConsoleLog(resolveReportPathInput);
    assert.deepStrictEqual(result, {
      reportPath: './coverage-legacy/',
      usedDeprecatedName: true,
    });
    assert.ok(logs.some((l) => l.includes('[WARN]')));
  } finally {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    });
  }
});
