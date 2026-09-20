'use strict';

const fs = require('fs');
const { pct } = require('../util/coverageUtil');

/**
 * c8（V8 覆盖率）报告解析器（coverage-final.json）。
 *
 * 结构：顶层 key 为文件路径，value：
 * {
 *   "path": "...",
 *   "statementMap": {"0": {"start": {"line": 1, "column": 0}, ...}, ...},
 *   "fnMap": {"0": {"name": "...", "loc": {...}}, ...},
 *   "branchMap": {"0": {"type": "if", "locations": [...]}, ...},
 *   "s": {"0": 1, ...},      // 语句命中次数
 *   "f": {"0": 1, ...},      // 函数命中次数
 *   "b": {"0": [1, 0], ...}  // 分支命中次数数组
 * }
 *
 * 行覆盖率：按 statementMap 起始行去重，行上有任何已覆盖语句即视为已覆盖（与 istanbul 行覆盖语义一致）；
 * methodCoverage 取函数覆盖率；branchCoverage 取分支覆盖率。c8 不产出 class 覆盖率，缺省。
 */

function parseFileObj(fileObj) {
  const statementMap = fileObj.statementMap || {};
  const s = fileObj.s || {};
  const fnMap = fileObj.fnMap || {};
  const f = fileObj.f || {};
  const branchMap = fileObj.branchMap || {};
  const b = fileObj.b || {};

  // 行覆盖：语句起始行去重
  const lines = new Map(); // line -> covered(boolean)
  for (const [id, stmt] of Object.entries(statementMap)) {
    const startLine = stmt && stmt.start && stmt.start.line;
    if (startLine == null) continue;
    const hit = Number(s[id] || 0) > 0;
    lines.set(startLine, lines.get(startLine) || hit);
  }
  let lineCovered = 0;
  for (const covered of lines.values()) {
    if (covered) lineCovered += 1;
  }
  const lineTotal = lines.size;

  const item = { filePath: fileObj.path };
  if (lineTotal > 0) {
    item.lineCoverage = pct(lineCovered, lineTotal);
    item.lineCovered = lineCovered;
    item.lineTotal = lineTotal;
  }

  // 方法覆盖率（函数）
  let methodCovered = 0;
  const methodTotal = Object.keys(fnMap).length;
  for (const [id, count] of Object.entries(f)) {
    if (Number(count || 0) > 0) methodCovered += 1;
  }
  if (methodTotal > 0) {
    item.methodCoverage = pct(methodCovered, methodTotal);
    item.methodCovered = methodCovered;
    item.methodTotal = methodTotal;
  }

  // 分支覆盖率
  let branchCovered = 0;
  let branchTotal = 0;
  for (const [id, counts] of Object.entries(b)) {
    const arr = Array.isArray(counts) ? counts : [counts];
    const targetCount = branchMap[id] && Array.isArray(branchMap[id].locations) ? branchMap[id].locations.length : arr.length;
    branchTotal += targetCount > 0 ? targetCount : arr.length;
    branchCovered += arr.filter((v) => Number(v || 0) > 0).length;
  }
  if (branchTotal > 0) {
    item.branchCoverage = pct(branchCovered, branchTotal);
    item.branchCovered = branchCovered;
    item.branchTotal = branchTotal;
  }

  return item;
}

function parseContent(data) {
  const files = [];
  let agg = { line: { covered: 0, total: 0 }, branch: { covered: 0, total: 0 }, method: { covered: 0, total: 0 } };

  for (const [filePath, value] of Object.entries(data)) {
    if (!value || typeof value !== 'object' || !value.statementMap) continue;
    const item = parseFileObj({ ...value, path: filePath });
    if (!item.lineTotal) continue;
    files.push(item);
    agg.line.covered += item.lineCovered || 0;
    agg.line.total += item.lineTotal || 0;
    if (item.branchTotal) {
      agg.branch.covered += item.branchCovered || 0;
      agg.branch.total += item.branchTotal;
    }
    if (item.methodTotal) {
      agg.method.covered += item.methodCovered || 0;
      agg.method.total += item.methodTotal;
    }
  }

  const metrics = { lineCoverage: pct(agg.line.covered, agg.line.total), lineCovered: agg.line.covered, lineTotal: agg.line.total };
  for (const type of ['branch', 'method']) {
    if (agg[type].total > 0) {
      metrics[`${type}Coverage`] = pct(agg[type].covered, agg[type].total);
      metrics[`${type}Covered`] = agg[type].covered;
      metrics[`${type}Total`] = agg[type].total;
    }
  }

  return { tool: 'c8', metrics, files };
}

function parseFile(file) {
  return parseContent(JSON.parse(fs.readFileSync(file, 'utf-8')));
}

module.exports = { parseFile, parseContent, parseFileObj };
