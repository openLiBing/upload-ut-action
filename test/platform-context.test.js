'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolvePlatformContext } = require('../index');
const { detectPlatform } = require('../src/util/platform');

test('detectPlatform：GITHUB_ACTIONS=true 且无 GitCode 上下文 → GitHub', () => {
  assert.strictEqual(detectPlatform({ GITHUB_ACTIONS: 'true' }), 'github');
});

test('detectPlatform：GITHUB_ACTIONS=true 但存在 ATOMGIT_* 关键上下文 → GitCode', () => {
  assert.strictEqual(detectPlatform({ GITHUB_ACTIONS: 'true', ATOMGIT_RUN_ID: 'run-1' }), 'gitcode');
  assert.strictEqual(
    detectPlatform({ GITHUB_ACTIONS: 'true', ATOMGIT_REPOSITORY_URL: 'https://gitcode.com/o/r.git' }),
    'gitcode'
  );
  assert.strictEqual(detectPlatform({ GITHUB_ACTIONS: 'true', ATOMGIT_REPOSITORY: 'o/r' }), 'gitcode');
});

test('detectPlatform：无 GITHUB_ACTIONS → GitCode', () => {
  assert.strictEqual(detectPlatform({}), 'gitcode');
});

test('GitHub push 事件只读 GITHUB_* 上下文', () => {
  const ctx = resolvePlatformContext({
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'openlibing/demo',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF_NAME: 'main',
    GITHUB_RUN_ID: '12345',
    GITHUB_SHA: 'abc123',
    GITHUB_WORKSPACE: '/home/runner/work/demo',
    // 非关键 GitCode 变量即使存在也不应参与 GitHub 上下文
    ATOMGIT_REF_NAME: 'ignored-branch',
    ATOMGIT_SHA: 'ignored-sha',
  });

  assert.strictEqual(ctx.isGithub, true);
  assert.strictEqual(ctx.gitUrl, 'https://github.com/openlibing/demo');
  assert.strictEqual(ctx.branchName, 'main');
  assert.strictEqual(ctx.pipelineRunId, '12345');
  assert.strictEqual(ctx.commitId, 'abc123');
  assert.strictEqual(ctx.repoName, 'demo');
  assert.strictEqual(ctx.workspace, '/home/runner/work/demo');
});

test('GitHub pull_request 事件使用源分支 GITHUB_HEAD_REF', () => {
  const ctx = resolvePlatformContext({
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF_NAME: '123/merge',
    GITHUB_BASE_REF: 'main',
    GITHUB_HEAD_REF: 'feature-x',
  });

  assert.strictEqual(ctx.branchName, 'feature-x');
});

test('GitHub pull_request_target 事件同样使用源分支', () => {
  const ctx = resolvePlatformContext({
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_EVENT_NAME: 'pull_request_target',
    GITHUB_REF_NAME: 'main',
    GITHUB_BASE_REF: 'main',
    GITHUB_HEAD_REF: 'feature-y',
  });

  assert.strictEqual(ctx.branchName, 'feature-y');
});

test('GitHub pull_request commitId 取源分支 head.sha', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-event-'));
  const eventPath = path.join(dir, 'event.json');
  fs.writeFileSync(
    eventPath,
    JSON.stringify({ pull_request: { base: { sha: 'base-sha' }, head: { sha: 'head-sha' } } })
  );
  try {
    const ctx = resolvePlatformContext({
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_HEAD_REF: 'feature-x',
      GITHUB_SHA: 'merge-sha',
      GITHUB_EVENT_PATH: eventPath,
    });

    assert.strictEqual(ctx.branchName, 'feature-x');
    assert.strictEqual(ctx.commitId, 'head-sha');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GitHub pull_request 事件文件内容非法时 commitId 回退 GITHUB_SHA', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-event-'));
  const eventPath = path.join(dir, 'event.json');
  fs.writeFileSync(eventPath, 'not-json');
  try {
    const ctx = resolvePlatformContext({
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'main',
      GITHUB_SHA: 'merge-sha',
      GITHUB_EVENT_PATH: eventPath,
    });

    assert.strictEqual(ctx.commitId, 'merge-sha');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GitHub pull_request 事件文件缺失时 commitId 回退 GITHUB_SHA', () => {
  const ctx = resolvePlatformContext({
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_BASE_REF: 'main',
    GITHUB_SHA: 'merge-sha',
    GITHUB_EVENT_PATH: path.join(os.tmpdir(), 'not-exists-event.json'),
  });

  assert.strictEqual(ctx.commitId, 'merge-sha');
});

test('GitHub SERVER_URL 末尾斜杠不产生双斜杠', () => {
  const ctx = resolvePlatformContext({
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.example.com/',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
  });

  assert.strictEqual(ctx.gitUrl, 'https://github.example.com/owner/repo');
});

test('双平台标志同时存在时按 GitCode 解析（兼容 runner 保护）', () => {
  const ctx = resolvePlatformContext({
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'ignored/repo',
    GITHUB_SERVER_URL: 'https://github.com',
    ATOMGIT_RUN_ID: 'run-1',
    ATOMGIT_REPOSITORY_URL: 'https://gitcode.com/openlibing/demo.git',
    ATOMGIT_REPOSITORY: 'openlibing/demo',
    ATOMGIT_REF_NAME: 'main',
    ATOMGIT_SHA: 'sha-1',
  });

  assert.strictEqual(ctx.isGithub, false);
  assert.strictEqual(ctx.gitUrl, 'https://gitcode.com/openlibing/demo');
  assert.strictEqual(ctx.branchName, 'main');
  assert.strictEqual(ctx.pipelineRunId, 'run-1');
  assert.strictEqual(ctx.commitId, 'sha-1');
  assert.strictEqual(ctx.repoName, 'demo');
});

test('GitCode push 事件保持 ATOMGIT_* 映射', () => {
  const ctx = resolvePlatformContext({
    ATOMGIT_REPOSITORY_URL: 'https://gitcode.com/openlibing/demo.git',
    ATOMGIT_REPOSITORY: 'openlibing/demo',
    ATOMGIT_EVENT_NAME: 'push',
    ATOMGIT_REF_NAME: 'main',
    ATOMGIT_RUN_ID: 'run-1',
    ATOMGIT_SHA: 'sha-1',
    WORKSPACE: '/home/workspace/demo',
    // GitHub 变量即使存在也不应参与 GitCode 上下文
    GITHUB_REPOSITORY: 'ignored/repo',
    GITHUB_REF_NAME: 'ignored-branch',
  });

  assert.strictEqual(ctx.isGithub, false);
  assert.strictEqual(ctx.gitUrl, 'https://gitcode.com/openlibing/demo');
  assert.strictEqual(ctx.branchName, 'main');
  assert.strictEqual(ctx.pipelineRunId, 'run-1');
  assert.strictEqual(ctx.commitId, 'sha-1');
  assert.strictEqual(ctx.repoName, 'demo');
  assert.strictEqual(ctx.workspace, '/home/workspace/demo');
});

test('GitCode MR 事件保持 ATOMGIT_HEAD_REF 既有行为', () => {
  const ctx = resolvePlatformContext({
    ATOMGIT_REPOSITORY: 'openlibing/demo',
    ATOMGIT_EVENT_NAME: 'MR',
    ATOMGIT_HEAD_REF: 'source-branch',
    ATOMGIT_REF_NAME: '123/merge',
  });

  assert.strictEqual(ctx.branchName, 'source-branch');
});

test('GitHub 缺少仓库变量时 gitUrl 为空且仓库名回退', () => {
  const ctx = resolvePlatformContext({ GITHUB_ACTIONS: 'true' });

  assert.strictEqual(ctx.gitUrl, '');
  assert.strictEqual(ctx.repoName, 'unknown-repo');
  assert.strictEqual(ctx.branchName, '');
  assert.strictEqual(ctx.pipelineRunId, '');
  assert.strictEqual(ctx.commitId, '');
});
