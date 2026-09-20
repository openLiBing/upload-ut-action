'use strict';

const fs = require('fs');
const { pct } = require('../util/coverageUtil');

/**
 * Jacoco 报告解析器（jacoco.xml）。
 *
 * jacoco.xml 结构（关键部分）：
 * <report>
 *   <package name="com/foo">
 *     <class name="com/foo/Bar" sourcefilename="Bar.java">...</class>
 *     <sourcefile name="Bar.java">
 *       <line nr="10" mi="0" ci="5" mb="0" cb="2"/>
 *       <counter type="LINE" missed=".." covered=".."/>
 *       <counter type="BRANCH" missed=".." covered=".."/>
 *       <counter type="METHOD" missed=".." covered=".."/>
 *       <counter type="CLASS" missed=".." covered=".."/>
 *     </sourcefile>
 *   </package>
 * </report>
 *
 * 文件明细取自 <sourcefile>（已按源码文件聚合），文件路径 = package.name + '/' + sourcefile.name；
 * 总体指标对所有 sourcefile 的 counter 求和（等于 report 级 totals）。
 */

/** 从 XML 片段中解析 <counter type="X" missed="n" covered="n"/> 列表 */
function parseCounters(block) {
  const counters = {};
  const re = /<counter\s+type="(\w+)"\s+missed="(\d+)"\s+covered="(\d+)"\s*\/>/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    counters[m[1].toLowerCase()] = {
      missed: parseInt(m[2], 10),
      covered: parseInt(m[3], 10),
    };
  }
  return counters;
}

/** 由 counter 集合构建统一文件条目；无 LINE 计数（空源码文件）返回 null */
function buildFileItem(filePath, counters) {
  const line = counters.line;
  if (!line) return null;
  const item = { filePath };
  const lineTotal = line.covered + line.missed;
  item.lineCoverage = pct(line.covered, lineTotal);
  item.lineCovered = line.covered;
  item.lineTotal = lineTotal;
  for (const type of ['branch', 'method', 'class']) {
    const c = counters[type];
    if (c) {
      const total = c.covered + c.missed;
      if (total > 0) {
        item[`${type}Coverage`] = pct(c.covered, total);
        item[`${type}Covered`] = c.covered;
        item[`${type}Total`] = total;
      }
    }
  }
  return item;
}

/** 解析 jacoco.xml 内容，返回统一中间结构 */
function parseContent(xml) {
  const agg = { line: { covered: 0, total: 0 }, branch: { covered: 0, total: 0 }, method: { covered: 0, total: 0 }, class: { covered: 0, total: 0 } };
  const files = [];

  const pkgRe = /<package\s+name="([^"]*)">([\s\S]*?)<\/package>/g;
  let pm;
  while ((pm = pkgRe.exec(xml)) !== null) {
    const pkgName = pm[1];
    const pkgBlock = pm[2];
    const sfRe = /<sourcefile\s+name="([^"]*)">([\s\S]*?)<\/sourcefile>/g;
    let sm;
    while ((sm = sfRe.exec(pkgBlock)) !== null) {
      const counters = parseCounters(sm[2]);
      const filePath = (pkgName ? pkgName + '/' : '') + sm[1];
      const item = buildFileItem(filePath, counters);
      if (item) files.push(item);
      for (const type of ['line', 'branch', 'method', 'class']) {
        const c = counters[type];
        if (c) {
          agg[type].covered += c.covered;
          agg[type].total += c.covered + c.missed;
        }
      }
    }
  }

  const metrics = { lineCoverage: pct(agg.line.covered, agg.line.total), lineCovered: agg.line.covered, lineTotal: agg.line.total };
  for (const type of ['branch', 'method', 'class']) {
    if (agg[type].total > 0) {
      metrics[`${type}Coverage`] = pct(agg[type].covered, agg[type].total);
      metrics[`${type}Covered`] = agg[type].covered;
      metrics[`${type}Total`] = agg[type].total;
    }
  }

  return { tool: 'jacoco', metrics, files };
}

function parseFile(file) {
  return parseContent(fs.readFileSync(file, 'utf-8'));
}

module.exports = { parseFile, parseContent, parseCounters, buildFileItem };
