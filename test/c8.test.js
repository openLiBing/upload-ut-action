'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const C8Parser = require('../src/parser/C8Parser');

const FIXTURE = path.join(__dirname, 'fixtures', 'coverage-final.json');

test('C8Parser 解析总体指标', () => {
  const parsed = C8Parser.parseFile(FIXTURE);
  assert.strictEqual(parsed.tool, 'c8');
  // 行：line1/2/7 已覆盖，line5 未覆盖 → 3/4 = 75%
  assert.strictEqual(parsed.metrics.lineCoverage, 75);
  assert.strictEqual(parsed.metrics.lineCovered, 3);
  assert.strictEqual(parsed.metrics.lineTotal, 4);
  // 方法：1/1 = 100%
  assert.strictEqual(parsed.metrics.methodCoverage, 100);
  // 分支：1/2 = 50%
  assert.strictEqual(parsed.metrics.branchCoverage, 50);
  // c8 无 class
  assert.strictEqual(parsed.metrics.classCoverage, undefined);
});

test('C8Parser 解析文件明细', () => {
  const parsed = C8Parser.parseFile(FIXTURE);
  assert.strictEqual(parsed.files.length, 1);
  const app = parsed.files[0];
  assert.strictEqual(app.filePath, 'src/app.js');
  assert.strictEqual(app.lineCoverage, 75);
  assert.strictEqual(app.lineCovered, 3);
  assert.strictEqual(app.lineTotal, 4);
  assert.strictEqual(app.methodCoverage, 100);
  assert.strictEqual(app.branchCoverage, 50);
});
