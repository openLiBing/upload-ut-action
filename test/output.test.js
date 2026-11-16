'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { setOutput } = require('../index');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-output-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('setOutput：GitHub 平台只写 GITHUB_OUTPUT', () => {
  withTempDir((dir) => {
    const githubOutput = path.join(dir, 'github_output');
    const atomgitOutput = path.join(dir, 'atomgit_output');
    setOutput('result', 'success', {
      GITHUB_ACTIONS: 'true',
      GITHUB_OUTPUT: githubOutput,
      ATOMGIT_OUTPUT: atomgitOutput,
    });

    assert.strictEqual(fs.readFileSync(githubOutput, 'utf-8'), 'result=success\n');
    assert.strictEqual(fs.existsSync(atomgitOutput), false);
  });
});

test('setOutput：GitCode 兼容 runner 同时注入 GITHUB_* 时仍写 ATOMGIT_OUTPUT', () => {
  withTempDir((dir) => {
    const githubOutput = path.join(dir, 'github_output');
    const atomgitOutput = path.join(dir, 'atomgit_output');
    setOutput('result', 'success', {
      GITHUB_ACTIONS: 'true',
      GITHUB_OUTPUT: githubOutput,
      ATOMGIT_RUN_ID: 'run-1',
      ATOMGIT_OUTPUT: atomgitOutput,
    });

    assert.strictEqual(fs.readFileSync(atomgitOutput, 'utf-8'), 'result=success\n');
    assert.strictEqual(fs.existsSync(githubOutput), false);
  });
});

test('setOutput：GitCode 平台兼容 STEP_OUTPUT 兜底', () => {
  withTempDir((dir) => {
    const stepOutput = path.join(dir, 'step_output');
    setOutput('result', 'failed', { STEP_OUTPUT: stepOutput });

    assert.strictEqual(fs.readFileSync(stepOutput, 'utf-8'), 'result=failed\n');
  });
});

test('setOutput：GitCode 同时存在 ATOMGIT_OUTPUT 与 STEP_OUTPUT 时优先 ATOMGIT_OUTPUT', () => {
  withTempDir((dir) => {
    const atomgitOutput = path.join(dir, 'atomgit_output');
    const stepOutput = path.join(dir, 'step_output');
    setOutput('result', 'success', {
      ATOMGIT_RUN_ID: 'run-1',
      ATOMGIT_OUTPUT: atomgitOutput,
      STEP_OUTPUT: stepOutput,
    });

    assert.strictEqual(fs.readFileSync(atomgitOutput, 'utf-8'), 'result=success\n');
    assert.strictEqual(fs.existsSync(stepOutput), false);
  });
});

test('setOutput：缺少输出变量时不抛错且不写文件', () => {
  withTempDir((dir) => {
    assert.doesNotThrow(() => setOutput('result', 'success', { GITHUB_WORKSPACE: dir }));
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});
