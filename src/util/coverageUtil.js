'use strict';

/**
 * 覆盖率通用工具：百分比计算（保留 2 位小数）。
 */

/** 四舍五入到 2 位小数 */
function round2(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * 覆盖率百分比：covered / total * 100，保留 2 位小数。
 * total 为 0 或非法时返回 null（表示该指标不可用，调用方按缺省处理）。
 */
function pct(covered, total) {
  const c = Number(covered);
  const t = Number(total);
  if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return null;
  return round2((c / t) * 100);
}

/** 把字符串解析为数字；非法返回 null */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { round2, pct, toNum };
