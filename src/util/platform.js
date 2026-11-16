'use strict';

/**
 * 平台判定：仅当 GITHUB_ACTIONS=true 且不存在 GitCode 关键上下文时视为 GitHub Actions。
 * GitHub Actions 兼容层 runner 可能同时注入 GITHUB_* 与 ATOMGIT_*；此时以 GitCode 为准，
 * 避免存量 GitCode 上报误切 GitHub 桶或使用 GitHubActions 提供商换证失败。
 */
function detectPlatform(env = process.env) {
  const hasGitCodeContext = Boolean(
    (env.ATOMGIT_RUN_ID || '').trim() ||
      (env.ATOMGIT_REPOSITORY_URL || '').trim() ||
      (env.ATOMGIT_REPOSITORY || '').trim()
  );
  return env.GITHUB_ACTIONS === 'true' && !hasGitCodeContext ? 'github' : 'gitcode';
}

module.exports = { detectPlatform };
