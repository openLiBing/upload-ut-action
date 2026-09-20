'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ReportScanner = require('../src/parser/ReportScanner');

const FIXTURES = path.join(__dirname, 'fixtures');

test('ReportScanner 按扩展名识别各工具报告', () => {
  assert.strictEqual(ReportScanner.detectByPath(path.join(FIXTURES, 'jacoco.xml')), 'jacoco');
  assert.strictEqual(ReportScanner.detectByPath(path.join(FIXTURES, 'coverage-final.json')), 'c8');
  assert.strictEqual(ReportScanner.detectByPath(path.join(FIXTURES, 'coverage.out')), 'go-test');
  assert.strictEqual(ReportScanner.detectByPath(path.join(FIXTURES, 'lcov.info')), 'lcov');
  assert.strictEqual(ReportScanner.detectByPath(path.join(FIXTURES, 'sample.gcov')), 'gcov');
});

test('ReportScanner 对歧义 JSON 内容嗅探', () => {
  // coverage.json → coverage.py（meta/files/totals）
  assert.strictEqual(ReportScanner.detectByPath(path.join(FIXTURES, 'coverage.json')), 'coverage-py');
  // llvm-cov export → cargo-llvm-cov（data 数组）
  assert.strictEqual(ReportScanner.detectByPath(path.join(FIXTURES, 'llvm-cov-export.json')), 'cargo-llvm-cov');
});

test('ReportScanner 目录递归扫描命中全部报告', () => {
  const reports = ReportScanner.scan([FIXTURES]);
  const tools = reports.map((r) => r.tool).sort();
  assert.deepStrictEqual(tools, [
    'c8',
    'cargo-llvm-cov',
    'coverage-py',
    'gcov',
    'go-test',
    'jacoco',
    'lcov',
  ]);
  // 去重：同一文件只出现一次
  const keys = new Set(reports.map((r) => r.file));
  assert.strictEqual(keys.size, reports.length);
});

test('ReportScanner 不存在的路径给出警告并跳过', () => {
  const reports = ReportScanner.scan(['/not/exist/report', FIXTURES]);
  assert.ok(reports.length > 0);
});

test('ReportScanner 非报告文件不被识别', () => {
  assert.strictEqual(ReportScanner.detectByPath(path.join(FIXTURES, 'sample.txt')), null);
});
