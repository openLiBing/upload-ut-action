'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const CargoLlvmCovParser = require('../src/parser/CargoLlvmCovParser');

const FIXTURE = path.join(__dirname, 'fixtures', 'llvm-cov-export.json');

test('CargoLlvmCovParser 解析总体指标（data[0].totals）', () => {
  const parsed = CargoLlvmCovParser.parseFile(FIXTURE);
  assert.strictEqual(parsed.tool, 'cargo-llvm-cov');
  // 行：110/140 = 78.57%
  assert.strictEqual(parsed.metrics.lineCoverage, 78.57);
  assert.strictEqual(parsed.metrics.lineCovered, 110);
  assert.strictEqual(parsed.metrics.lineTotal, 140);
  // 方法：5/6 = 83.33%
  assert.strictEqual(parsed.metrics.methodCoverage, 83.33);
  // 分支：6/10 = 60%
  assert.strictEqual(parsed.metrics.branchCoverage, 60);
});

test('CargoLlvmCovParser 解析文件明细（branches 为 null 时缺省）', () => {
  const parsed = CargoLlvmCovParser.parseFile(FIXTURE);
  assert.strictEqual(parsed.files.length, 2);

  const lib = parsed.files.find((f) => f.filePath === 'src/lib.rs');
  assert.ok(lib);
  assert.strictEqual(lib.lineCoverage, 80);
  assert.strictEqual(lib.branchCoverage, 60);
  assert.strictEqual(lib.methodCoverage, 80);

  const util = parsed.files.find((f) => f.filePath === 'src/util.rs');
  assert.ok(util);
  assert.strictEqual(util.lineCoverage, 75);
  // rust target 无 branch 数据 → 该指标缺省
  assert.strictEqual(util.branchCoverage, undefined);
  assert.strictEqual(util.methodCoverage, 100);
});

test('CargoLlvmCovParser 对缺 data 数组抛错', () => {
  assert.throws(() => CargoLlvmCovParser.parseContent({ files: [] }), /缺少 data 数组/);
});
