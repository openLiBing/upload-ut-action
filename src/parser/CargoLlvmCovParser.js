'use strict';

const fs = require('fs');
const { pct } = require('../util/coverageUtil');

/**
 * llvm-cov export JSON 报告解析器（cargo-llvm-cov --json / llvm-cov export --format=json）。
 *
 * 结构：
 * {
 *   "data": [
 *     {
 *       "files": [
 *         {
 *           "filename": "src/lib.rs",
 *           "summary": {
 *             "lines":      {"count": 100, "covered": 80, "percent": 80.0},
 *             "functions":  {"count": 5, "covered": 4, "percent": 80.0},
 *             "branches":   {"count": 10, "covered": 6, "percent": 60.0},
 *             "regions":    {...},
 *             "instantiations": {...}
 *           }
 *         }
 *       ],
 *       "totals": { "lines": {...}, "functions": {...}, "branches": {...}, ... }
 *     }
 *   ]
 * }
 *
 * lineCoverage 取 lines 统计；methodCoverage 取 functions；branchCoverage 取 branches
 * （rust 某些 target 的 branches 可能为 null，此时该指标缺省）。class 覆盖率不适用，缺省。
 */

const SUMMARY_KEYS = { lines: 'line', functions: 'method', branches: 'branch' };

function buildItemFromSummary(filePath, summary) {
  const s = summary || {};
  const item = { filePath };
  for (const [key, prefix] of Object.entries(SUMMARY_KEYS)) {
    const stat = s[key];
    if (!stat || stat.count == null || stat.covered == null) continue;
    const total = Number(stat.count);
    const covered = Number(stat.covered);
    if (total <= 0) continue;
    item[`${prefix}Coverage`] = pct(covered, total);
    item[`${prefix}Covered`] = covered;
    item[`${prefix}Total`] = total;
  }
  return item;
}

function parseContent(data) {
  const d = data && Array.isArray(data.data) ? data.data[0] : null;
  if (!d) {
    throw new Error('无法解析 llvm-cov export JSON：缺少 data 数组');
  }

  const files = [];
  let agg = { line: { covered: 0, total: 0 }, branch: { covered: 0, total: 0 }, method: { covered: 0, total: 0 } };

  for (const f of d.files || []) {
    const item = buildItemFromSummary(f.filename, f.summary);
    if (!item.lineTotal) continue;
    files.push(item);
    for (const [key, prefix] of Object.entries(SUMMARY_KEYS)) {
      const stat = f.summary && f.summary[key];
      if (stat && stat.count != null && stat.covered != null) {
        agg[prefix].covered += Number(stat.covered);
        agg[prefix].total += Number(stat.count);
      }
    }
  }

  // 总体优先取 data[0].totals（与 files 求和一致）
  const totals = d.totals || {};
  const metrics = {};
  if (totals.lines && totals.lines.count != null) {
    metrics.lineCoverage = pct(totals.lines.covered, totals.lines.count);
    metrics.lineCovered = Number(totals.lines.covered);
    metrics.lineTotal = Number(totals.lines.count);
  } else {
    metrics.lineCoverage = pct(agg.line.covered, agg.line.total);
    metrics.lineCovered = agg.line.covered;
    metrics.lineTotal = agg.line.total;
  }
  for (const [key, prefix] of Object.entries(SUMMARY_KEYS)) {
    if (prefix === 'line') continue;
    const stat = totals[key];
    if (stat && stat.count != null && Number(stat.count) > 0) {
      metrics[`${prefix}Coverage`] = pct(stat.covered, stat.count);
      metrics[`${prefix}Covered`] = Number(stat.covered);
      metrics[`${prefix}Total`] = Number(stat.count);
    } else if (agg[prefix].total > 0) {
      metrics[`${prefix}Coverage`] = pct(agg[prefix].covered, agg[prefix].total);
      metrics[`${prefix}Covered`] = agg[prefix].covered;
      metrics[`${prefix}Total`] = agg[prefix].total;
    }
  }

  return { tool: 'cargo-llvm-cov', metrics, files };
}

function parseFile(file) {
  return parseContent(JSON.parse(fs.readFileSync(file, 'utf-8')));
}

module.exports = { parseFile, parseContent, buildItemFromSummary };
