'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const JacocoParser = require('../src/parser/JacocoParser');

const FIXTURE = path.join(__dirname, 'fixtures', 'jacoco.xml');

test('JacocoParser 解析总体指标', () => {
  const parsed = JacocoParser.parseFile(FIXTURE);
  assert.strictEqual(parsed.tool, 'jacoco');
  // 总体：LINE covered=7 missed=1 → 87.5%
  assert.strictEqual(parsed.metrics.lineCoverage, 87.5);
  assert.strictEqual(parsed.metrics.lineCovered, 7);
  assert.strictEqual(parsed.metrics.lineTotal, 8);
  // 总体：BRANCH covered=2 missed=1 → 66.67%
  assert.strictEqual(parsed.metrics.branchCoverage, 66.67);
  // 总体：METHOD covered=3 missed=1 → 75%
  assert.strictEqual(parsed.metrics.methodCoverage, 75);
  // 总体：CLASS covered=2 missed=0 → 100%
  assert.strictEqual(parsed.metrics.classCoverage, 100);
});

test('JacocoParser 解析文件明细', () => {
  const parsed = JacocoParser.parseFile(FIXTURE);
  assert.strictEqual(parsed.files.length, 2);

  const foo = parsed.files.find((f) => f.filePath === 'com/example/Foo.java');
  assert.ok(foo, '应包含 com/example/Foo.java');
  assert.strictEqual(foo.lineCoverage, 80);
  assert.strictEqual(foo.lineCovered, 4);
  assert.strictEqual(foo.lineTotal, 5);
  assert.strictEqual(foo.branchCoverage, 66.67);
  assert.strictEqual(foo.methodCoverage, 50);
  assert.strictEqual(foo.classCoverage, 100);

  const util = parsed.files.find((f) => f.filePath === 'com/example/sub/Util.java');
  assert.ok(util, '应包含 com/example/sub/Util.java');
  assert.strictEqual(util.lineCoverage, 100);
  // Util.java 无 BRANCH counter，branch 指标应缺省
  assert.strictEqual(util.branchCoverage, undefined);
  assert.strictEqual(util.methodCoverage, 100);
});

test('JacocoParser 对无行计数的 sourcefile 应跳过', () => {
  const xml = '<report><package name="p"><sourcefile name="Empty.java"><counter type="METHOD" missed="0" covered="0"/></sourcefile></package></report>';
  const parsed = JacocoParser.parseContent(xml);
  assert.strictEqual(parsed.files.length, 0);
});
