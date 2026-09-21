'use strict';

const { pct } = require('../util/coverageUtil');

/**
 * 覆盖率标准 JSON 归一化器。
 *
 * 职责：
 * 1. 合并多个解析结果（同一代码仓可能产出多种工具报告，如 Java + JS 混合）：
 *    - 文件明细直接拼接；
 *    - 总体指标按 covered/total 重新求和（等价于报告级 totals 聚合）。
 * 2. 文件路径归一化：剥离仓库根前缀、file:// 前缀、前导 ./ 与 /，统一为仓库相对路径。
 * 3. 组装标准上报 JSON：仅保留行覆盖率 lineCoverage（唯一必填指标）。
 */

/** 文件路径归一化：机器绝对路径 / file:// / ./ 前缀 → 仓库相对路径 */
function normalizeFilePath(p, repoRoot) {
  let fp = String(p == null ? '' : p).replace(/\\/g, '/');
  if (fp.startsWith('file://')) fp = fp.slice('file://'.length);
  if (repoRoot) {
    const root = String(repoRoot).replace(/\\/g, '/').replace(/\/+$/, '');
    if (fp.startsWith(root + '/')) fp = fp.slice(root.length + 1);
  }
  fp = fp.replace(/^\.\//, '').replace(/^\/+/, '');
  return fp;
}

/** 过滤并归一化文件明细数组：剔除无行数据的条目，路径归一化，仅保留行覆盖率指标 */
function buildFileDetails(files, repoRoot) {
  const out = [];
  const seen = new Map(); // 同路径去重（多报告合并时同文件只保留首个）
  for (const f of files) {
    const lineTotal = Number(f.lineTotal || 0);
    if (!(lineTotal > 0)) continue;
    const filePath = normalizeFilePath(f.filePath, repoRoot);
    if (!filePath) continue;
    if (seen.has(filePath)) continue;
    seen.set(filePath, true);
    out.push({
      filePath,
      lineCoverage: Number(f.lineCoverage),
      lineCovered: Number(f.lineCovered || 0),
      lineTotal,
    });
  }
  return out;
}

/**
 * 合并解析结果并组装标准 JSON。
 * @param {Array} parsedList 各解析器返回的统一中间结构
 * @param {{gitUrl: string, branchName: string, pipelineRunId: string, commitId: string}} meta 上报元数据
 * @param {string} [repoRoot] 仓库根目录（用于文件路径归一化）
 * @returns {Object} 标准上报 JSON
 */
function normalize(parsedList, meta, repoRoot) {
  const agg = { line: { covered: 0, total: 0 } };
  const allFiles = [];

  for (const parsed of parsedList || []) {
    if (!parsed || !parsed.metrics) continue;
    const m = parsed.metrics;
    if (m.lineTotal != null) {
      agg.line.covered += Number(m.lineCovered || 0);
      agg.line.total += Number(m.lineTotal);
    }
    if (Array.isArray(parsed.files)) {
      allFiles.push(...parsed.files);
    }
  }

  if (!(agg.line.total > 0)) {
    throw new Error('未解析到有效的行覆盖率数据（lineCoverage 是唯一必填指标）');
  }

  const out = {
    gitUrl: meta.gitUrl || '',
    branchName: meta.branchName || '',
    pipelineRunId: meta.pipelineRunId || '',
    commitId: meta.commitId || '',
    lineCoverage: pct(agg.line.covered, agg.line.total),
  };

  const fileDetails = buildFileDetails(allFiles, repoRoot);
  out.fileDetails = fileDetails;
  return out;
}

module.exports = { normalize, normalizeFilePath, buildFileDetails };
