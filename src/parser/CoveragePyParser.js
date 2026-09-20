'use strict';

const fs = require('fs');
const { pct } = require('../util/coverageUtil');

/**
 * coverage.py 覆盖率报告解析器（coverage.json）。
 *
 * 结构：
 * {
 *   "meta": {"format": 2, ...},
 *   "files": {
 *     "path/to/a.py": {
 *       "executed_lines": [...],
 *       "summary": {"covered_lines": 3, "num_statements": 5, "percent_covered": 60.0,
 *                   "missing_branches": 1, "branches": 2}
 *     }
 *   },
 *   "totals": {"covered_lines": 100, "num_statements": 200, "percent_covered": 50.0,
 *              "missing_branches": 3, "branches": 4}
 * }
 *
 * lineCoverage 由 percent_covered（totals）提供；branchCoverage = (branches - missing_branches) / branches。
 * coverage.py 不产出 method/class 覆盖率，缺省。
 */

function buildFileItem(filePath, summary) {
  const s = summary || {};
  const item = { filePath };
  let has = false;
  if (s.num_statements != null && s.covered_lines != null) {
    item.lineCoverage = pct(s.covered_lines, s.num_statements);
    item.lineCovered = s.covered_lines;
    item.lineTotal = s.num_statements;
    has = true;
  }
  if (s.branches != null && Number(s.branches) > 0) {
    const covered = Number(s.branches) - Number(s.missing_branches || 0);
    item.branchCoverage = pct(covered, s.branches);
    item.branchCovered = covered;
    item.branchTotal = s.branches;
  }
  return has ? item : null;
}

function parseContent(data) {
  const totals = data.totals || {};
  const filesObj = data.files || {};
  const files = [];

  for (const [filePath, info] of Object.entries(filesObj)) {
    if (!info || typeof info !== 'object') continue;
    const item = buildFileItem(filePath, info.summary);
    if (item && item.lineTotal) files.push(item);
  }

  const metrics = {};
  if (totals.percent_covered != null) {
    metrics.lineCoverage = pct(totals.percent_covered, 100);
  } else if (totals.num_statements != null && totals.covered_lines != null) {
    metrics.lineCoverage = pct(totals.covered_lines, totals.num_statements);
  }
  if (totals.num_statements != null) {
    metrics.lineCovered = Number(totals.covered_lines != null ? totals.covered_lines : 0);
    metrics.lineTotal = Number(totals.num_statements);
  }
  if (totals.branches != null && Number(totals.branches) > 0) {
    const covered = Number(totals.branches) - Number(totals.missing_branches || 0);
    metrics.branchCoverage = pct(covered, totals.branches);
    metrics.branchCovered = covered;
    metrics.branchTotal = Number(totals.branches);
  }

  return { tool: 'coverage-py', metrics, files };
}

function parseFile(file) {
  return parseContent(JSON.parse(fs.readFileSync(file, 'utf-8')));
}

module.exports = { parseFile, parseContent, buildFileItem };
