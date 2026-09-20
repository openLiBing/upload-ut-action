'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const GoTestParser = require('../src/parser/GoTestParser');

const FIXTURE = path.join(__dirname, 'fixtures', 'coverage.out');

test('GoTestParser 解析总体指标', () => {
  const parsed = GoTestParser.parseFile(FIXTURE);
  assert.strictEqual(parsed.tool, 'go-test');
  // 4 个语句块，3 个已覆盖 → 75%
  assert.strictEqual(parsed.metrics.lineCoverage, 75);
  assert.strictEqual(parsed.metrics.lineCovered, 3);
  assert.strictEqual(parsed.metrics.lineTotal, 4);
  // go 无 branch/method/class
  assert.strictEqual(parsed.metrics.branchCoverage, undefined);
});

test('GoTestParser 解析文件明细', () => {
  const parsed = GoTestParser.parseFile(FIXTURE);
  assert.strictEqual(parsed.files.length, 2);

  const a = parsed.files.find((f) => f.filePath === 'openlibing/pkg/a.go');
  assert.ok(a);
  assert.strictEqual(a.lineCoverage, 100);
  assert.strictEqual(a.lineCovered, 2);
  assert.strictEqual(a.lineTotal, 2);

  const b = parsed.files.find((f) => f.filePath === 'openlibing/pkg/b.go');
  assert.ok(b);
  assert.strictEqual(b.lineCoverage, 50);
  assert.strictEqual(b.lineCovered, 1);
  assert.strictEqual(b.lineTotal, 2);
});

test('GoTestParser 忽略空文件/无模式行', () => {
  const parsed = GoTestParser.parseContent('mode: set\n');
  assert.strictEqual(parsed.metrics.lineTotal, 0);
  assert.strictEqual(parsed.files.length, 0);
});
