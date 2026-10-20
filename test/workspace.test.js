'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findGitDir, resolveRepoRoot } = require('../index');

/** 构造临时目录树：segments 相对 root 依次创建为目录 */
function mkdirs(root, segments) {
  let cur = root;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    fs.mkdirSync(cur, { recursive: true });
  }
  return cur;
}

test('findGitDir 命中根目录一级 .git', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdir-'));
  fs.mkdirSync(path.join(root, '.git'));
  assert.strictEqual(findGitDir(root), path.join(root, '.git'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('findGitDir 在 maxdepth 3 内命中嵌套 .git', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdir-'));
  const nested = mkdirs(root, ['a', 'b']);
  fs.mkdirSync(path.join(nested, '.git'));
  assert.strictEqual(findGitDir(root), path.join(nested, '.git'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('findGitDir 超出 maxdepth 3 不命中', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdir-'));
  const tooDeep = mkdirs(root, ['a', 'b', 'c']);
  fs.mkdirSync(path.join(tooDeep, '.git'));
  assert.strictEqual(findGitDir(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('findGitDir 无 .git 返回 null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdir-'));
  fs.mkdirSync(path.join(root, 'plain'));
  assert.strictEqual(findGitDir(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveRepoRoot 命中 git 根时返回其父目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdir-'));
  fs.mkdirSync(path.join(root, '.git'));
  assert.strictEqual(resolveRepoRoot(root), root);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveRepoRoot 无 .git 兜底 workspace 本身', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdir-'));
  assert.strictEqual(resolveRepoRoot(root), root);
  fs.rmSync(root, { recursive: true, force: true });
});
