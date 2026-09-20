'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 覆盖率报告扫描器：按扩展名优先识别，再对歧义 JSON（coverage.json 等）做内容嗅探。
 *
 * 识别规则（优先级从高到低）：
 * - jacoco.xml            → jacoco
 * - coverage-final.json   → c8
 * - coverage*.out         → go-test
 * - .lcov / .info         → lcov（GcovParser 的 lcov 分支）
 * - .gcov                 → gcov 文本（GcovParser 的 gcov 分支）
 * - coverage.json 等 .json → 内容嗅探：llvm-cov export（data 数组）→ cargo-llvm-cov；
 *                            coverage.py（meta/files/totals）→ coverage-py；c8（statementMap）→ c8
 */

/** 读取 JSON 内容（失败返回 null） */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/** 内容嗅探 JSON 报告类型 */
function sniffJson(json) {
  if (!json || typeof json !== 'object') return null;
  // llvm-cov export：顶层 data 数组，且首个元素含 files
  if (Array.isArray(json.data) && json.data[0] && Array.isArray(json.data[0].files)) {
    return 'cargo-llvm-cov';
  }
  // coverage.py：meta / totals + files（对象）
  if ((json.meta || json.totals) && json.files && typeof json.files === 'object') {
    return 'coverage-py';
  }
  // c8 coverage-final：值为 statementMap 对象
  const values = Object.values(json);
  if (values.some((v) => v && typeof v === 'object' && v.statementMap)) {
    return 'c8';
  }
  return null;
}

/** 按文件路径识别工具；无法确定返回 null */
function detectByPath(file) {
  const name = path.basename(file).toLowerCase();
  if (/jacoco\.xml$/i.test(name)) return 'jacoco';
  if (/coverage-final\.json$/i.test(name)) return 'c8';
  if (/^coverage[\w.-]*\.(out|cov|txt)$/i.test(name)) return 'go-test';
  if (/\.(lcov|info)$/i.test(name)) return 'lcov';
  if (/\.gcov$/i.test(name)) return 'gcov';
  if (/\.json$/i.test(name)) {
    const sniffed = sniffJson(readJson(file));
    if (sniffed) return sniffed;
    // 兜底：coverage.json 无法识别时按 coverage.py 处理（最常见）
    if (/coverage\.json$/i.test(name)) return 'coverage-py';
    return null;
  }
  return null;
}

/** 递归扫描目录，返回文件路径列表 */
function walkDir(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 扫描输入路径（逗号分隔：文件或目录），返回识别出的报告列表。
 * @param {string[]} inputs 用户输入路径列表
 * @returns {{file: string, tool: string}[]}
 */
function scan(inputs) {
  const reports = [];
  for (const raw of inputs) {
    const p = raw.trim();
    if (!p) continue;
    let abs = p;
    if (!fs.existsSync(abs)) {
      const workspace = process.env.WORKSPACE || process.cwd();
      const joined = path.join(workspace, p);
      if (fs.existsSync(joined)) abs = joined;
    }
    if (!fs.existsSync(abs)) {
      console.log(`[WARN] 报告路径不存在，跳过: ${p}`);
      continue;
    }
    const stat = fs.statSync(abs);
    const files = stat.isDirectory() ? walkDir(abs, []) : [abs];
    for (const file of files) {
      const tool = detectByPath(file);
      if (tool) {
        reports.push({ file, tool });
      }
    }
  }
  // 去重（同一文件被多次输入命中）
  const seen = new Set();
  return reports.filter((r) => {
    const key = r.file + '|' + r.tool;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { scan, detectByPath, sniffJson, walkDir };
