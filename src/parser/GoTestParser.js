'use strict';

const fs = require('fs');
const { pct } = require('../util/coverageUtil');

/**
 * Go test 覆盖率报告解析器（go test -coverprofile 输出，如 coverage.out）。
 *
 * 结构：
 * mode: count
 * openlibing/foo/bar.go:10.13,12.2 1 1
 * openlibing/foo/bar.go:15.2,20.8 1 1
 * openlibing/foo/baz.go:3.2,4.8 1 0
 *
 * 每行 = 一个语句块：file:startLine.startCol,endLine.endCol numStmts count。
 * count>0 表示该块被执行过。行覆盖率按语句块近似（covered 块数 / 总块数），
 * 与 go test 输出的 "xx.x% of statements" 语义一致。go 不产出 branch/method/class，缺省。
 */

const BLOCK_RE = /^(.+?):(\d+)\.\d+,(\d+)\.\d+\s+\d+\s+(\d+)$/;

function parseContent(content) {
  const perFile = new Map(); // filePath -> { covered, total }

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('mode:')) continue;
    const m = BLOCK_RE.exec(line);
    if (!m) continue;
    const filePath = m[1];
    const count = parseInt(m[4], 10);
    let rec = perFile.get(filePath);
    if (!rec) {
      rec = { covered: 0, total: 0 };
      perFile.set(filePath, rec);
    }
    rec.total += 1;
    if (count > 0) rec.covered += 1;
  }

  const files = [];
  let aggCovered = 0;
  let aggTotal = 0;
  for (const [filePath, rec] of perFile.entries()) {
    files.push({
      filePath,
      lineCoverage: pct(rec.covered, rec.total),
      lineCovered: rec.covered,
      lineTotal: rec.total,
    });
    aggCovered += rec.covered;
    aggTotal += rec.total;
  }

  return {
    tool: 'go-test',
    metrics: { lineCoverage: pct(aggCovered, aggTotal), lineCovered: aggCovered, lineTotal: aggTotal },
    files,
  };
}

function parseFile(file) {
  const content = fs.readFileSync(file, 'utf-8');
  // 单文件模式（go test -coverprofile 单输出）：直接用文件名作为相对路径基准
  const parsed = parseContent(content);
  // 若 go 输出了机器绝对路径，统一只取相对路径（后续 normalize 再处理）
  return parsed;
}

module.exports = { parseFile, parseContent };
