'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const CoveragePyParser = require('../src/parser/CoveragePyParser');

const FIXTURE = path.join(__dirname, 'fixtures', 'coverage.json');

test('CoveragePyParser 解析总体指标（totals.percent_covered）', () => {
  const parsed = CoveragePyParser.parseFile(FIXTURE);
  assert.strictEqual(parsed.tool, 'coverage-py');
  assert.strictEqual(parsed.metrics.lineCoverage, 66.67);
  assert.strictEqual(parsed.metrics.lineCovered, 4);
  assert.strictEqual(parsed.metrics.lineTotal, 6);
  // 分支：(3 - 1) / 3 = 66.67%
  assert.strictEqual(parsed.metrics.branchCoverage, 66.67);
  // coverage.py 无 method/class，应缺省
  assert.strictEqual(parsed.metrics.methodCoverage, undefined);
  assert.strictEqual(parsed.metrics.classCoverage, undefined);
});

test('CoveragePyParser 解析文件明细', () => {
  const parsed = CoveragePyParser.parseFile(FIXTURE);
  assert.strictEqual(parsed.files.length, 2);

  const a = parsed.files.find((f) => f.filePath === 'src/a.py');
  assert.ok(a);
  assert.strictEqual(a.lineCoverage, 75);
  assert.strictEqual(a.lineCovered, 3);
  assert.strictEqual(a.lineTotal, 4);
  assert.strictEqual(a.branchCoverage, 50);

  const b = parsed.files.find((f) => f.filePath === 'src/b.py');
  assert.ok(b);
  assert.strictEqual(b.lineCoverage, 50);
  assert.strictEqual(b.branchCoverage, 100);
});
