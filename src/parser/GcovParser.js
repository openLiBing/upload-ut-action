'use strict';

const fs = require('fs');
const path = require('path');
const { pct } = require('../util/coverageUtil');

/**
 * gcov / llvm-cov 覆盖率报告解析器。
 *
 * 支持两种格式：
 * 1. lcov 格式（gcov 经 geninfo 生成、llvm-cov --format=lcov、cargo-llvm-cov --lcov）：
 *    SF:<file>
 *    FNF:<functions found> / FNH:<functions hit>
 *    BRF:<branches found> / BRH:<branches hit>
 *    LF:<lines found> / LH:<lines hit>
 *    end_of_record
 * 2. 纯 .gcov 文本（gcov 直接输出，每文件一个）：
 *            1:    5:    int foo() {     ← 已覆盖（计数 > 0）
 *         #####:    6:    bar();          ← 未覆盖
 *            -:    7:    }
 */

const GCOV_LINE_RE = /^\s*(?:(\d+)|#####|=====):\s*(\d+):/;

/** 解析 lcov 内容，返回统一中间结构 */
function parseLcovContent(content) {
  const records = [];
  let current = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'end_of_record') {
      if (current) {
        records.push(current);
        current = null;
      }
      continue;
    }
    if (!current) current = {};
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    current[key] = value;
  }
  if (current) records.push(current);

  const files = [];
  let agg = { line: { covered: 0, total: 0 }, branch: { covered: 0, total: 0 }, method: { covered: 0, total: 0 } };

  for (const rec of records) {
    if (!rec.SF) continue;
    const item = { filePath: rec.SF };
    if (rec.LF != null && rec.LH != null) {
      const total = Number(rec.LF);
      const covered = Number(rec.LH);
      item.lineCoverage = pct(covered, total);
      item.lineCovered = covered;
      item.lineTotal = total;
      agg.line.covered += covered;
      agg.line.total += total;
    }
    if (rec.BRF != null && rec.BRH != null) {
      const total = Number(rec.BRF);
      const covered = Number(rec.BRH);
      if (total > 0) {
        item.branchCoverage = pct(covered, total);
        item.branchCovered = covered;
        item.branchTotal = total;
        agg.branch.covered += covered;
        agg.branch.total += total;
      }
    }
    if (rec.FNF != null && rec.FNH != null) {
      const total = Number(rec.FNF);
      const covered = Number(rec.FNH);
      if (total > 0) {
        item.methodCoverage = pct(covered, total);
        item.methodCovered = covered;
        item.methodTotal = total;
        agg.method.covered += covered;
        agg.method.total += total;
      }
    }
    if (item.lineTotal) files.push(item);
  }

  const metrics = { lineCoverage: pct(agg.line.covered, agg.line.total), lineCovered: agg.line.covered, lineTotal: agg.line.total };
  for (const type of ['branch', 'method']) {
    if (agg[type].total > 0) {
      metrics[`${type}Coverage`] = pct(agg[type].covered, agg[type].total);
      metrics[`${type}Covered`] = agg[type].covered;
      metrics[`${type}Total`] = agg[type].total;
    }
  }

  return { tool: 'gcov', metrics, files };
}

/** 解析单个纯 .gcov 文本文件（对应一个源码文件） */
function parseGcovTextContent(content, fileName) {
  let covered = 0;
  let total = 0;
  for (const line of content.split(/\r?\n/)) {
    const m = GCOV_LINE_RE.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] && parseInt(m[1], 10) > 0) covered += 1;
  }
  const filePath = fileName.replace(/\.gcov$/i, '');
  const item = {
    filePath,
    lineCoverage: pct(covered, total),
    lineCovered: covered,
    lineTotal: total,
  };
  return {
    tool: 'gcov',
    metrics: { lineCoverage: pct(covered, total), lineCovered: covered, lineTotal: total },
    files: [item],
  };
}

/** 按文件内容自动识别 lcov 还是纯 gcov 文本 */
function isLcovContent(content) {
  return /^\s*SF:/m.test(content);
}

function parseFile(file) {
  const content = fs.readFileSync(file, 'utf-8');
  return isLcovContent(content)
    ? parseLcovContent(content)
    : parseGcovTextContent(content, path.basename(file));
}

module.exports = { parseFile, parseLcovContent, parseGcovTextContent, isLcovContent };
