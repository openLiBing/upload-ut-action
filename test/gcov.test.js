'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const GcovParser = require('../src/parser/GcovParser');

const LCOV = path.join(__dirname, 'fixtures', 'lcov.info');
const GCOV = path.join(__dirname, 'fixtures', 'sample.gcov');

test('GcovParser 解析 lcov 总体指标', () => {
  const parsed = GcovParser.parseFile(LCOV);
  assert.strictEqual(parsed.tool, 'gcov');
  // 行：(90+30)/(120+30) = 80%
  assert.strictEqual(parsed.metrics.lineCoverage, 80);
  assert.strictEqual(parsed.metrics.lineCovered, 120);
  assert.strictEqual(parsed.metrics.lineTotal, 150);
  // 分支：(3+2)/(4+2) = 83.33%
  assert.strictEqual(parsed.metrics.branchCoverage, 83.33);
  // 方法：(2+1)/(3+1) = 75%
  assert.strictEqual(parsed.metrics.methodCoverage, 75);
});

test('GcovParser 解析 lcov 文件明细', () => {
  const parsed = GcovParser.parseFile(LCOV);
  assert.strictEqual(parsed.files.length, 2);

  const main = parsed.files.find((f) => f.filePath === '/builds/foo/src/main.c');
  assert.ok(main);
  assert.strictEqual(main.lineCoverage, 75);
  assert.strictEqual(main.branchCoverage, 75);
  assert.strictEqual(main.methodCoverage, 66.67);

  const util = parsed.files.find((f) => f.filePath === '/builds/foo/src/util.c');
  assert.ok(util);
  assert.strictEqual(util.lineCoverage, 100);
});

test('GcovParser 解析纯 .gcov 文本（单文件）', () => {
  const parsed = GcovParser.parseFile(GCOV);
  assert.strictEqual(parsed.tool, 'gcov');
  // 代码行 2-6 共 5 行，覆盖 4 行 → 80%；文件名剥离 .gcov 后缀
  assert.strictEqual(parsed.metrics.lineCoverage, 80);
  assert.strictEqual(parsed.metrics.lineCovered, 4);
  assert.strictEqual(parsed.metrics.lineTotal, 5);
  assert.strictEqual(parsed.files.length, 1);
  assert.strictEqual(parsed.files[0].filePath, 'sample');
});

test('GcovParser 识别 lcov 与 gcov 文本', () => {
  const fs = require('fs');
  assert.strictEqual(GcovParser.isLcovContent(fs.readFileSync(LCOV, 'utf-8')), true);
  assert.strictEqual(GcovParser.isLcovContent(fs.readFileSync(GCOV, 'utf-8')), false);
});
