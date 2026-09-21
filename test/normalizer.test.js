'use strict';

const test = require('node:test');
const assert = require('node:assert');

const CoverageNormalizer = require('../src/normalizer/CoverageNormalizer');

test('CoverageNormalizer 单报告组装标准 JSON', () => {
  const parsed = {
    tool: 'jacoco',
    metrics: { lineCoverage: 80, lineCovered: 4, lineTotal: 5, branchCoverage: 66.67, branchCovered: 2, branchTotal: 3 },
    files: [
      { filePath: 'com/example/Foo.java', lineCoverage: 80, lineCovered: 4, lineTotal: 5, branchCoverage: 66.67, branchCovered: 2, branchTotal: 3 },
      { filePath: 'com/example/Empty.java', lineCoverage: null, lineCovered: 0, lineTotal: 0 },
    ],
  };
  const out = CoverageNormalizer.normalize([parsed], { gitUrl: 'https://gitcode.com/o/r', branchName: 'master', pipelineRunId: '123', commitId: 'abc' }, '');
  assert.strictEqual(out.gitUrl, 'https://gitcode.com/o/r');
  assert.strictEqual(out.branchName, 'master');
  assert.strictEqual(out.pipelineRunId, '123');
  assert.strictEqual(out.commitId, 'abc');
  assert.strictEqual(out.lineCoverage, 80);
  // 仅行覆盖率指标：可选指标不再输出
  assert.strictEqual(out.branchCoverage, undefined);
  assert.strictEqual(out.methodCoverage, undefined);
  assert.strictEqual(out.classCoverage, undefined);
  // 无行数据文件被剔除
  assert.strictEqual(out.fileDetails.length, 1);
  assert.strictEqual(out.fileDetails[0].filePath, 'com/example/Foo.java');
});

test('CoverageNormalizer 多报告合并：总体重新求和 + 文件明细拼接', () => {
  const jacoco = {
    tool: 'jacoco',
    metrics: { lineCoverage: 80, lineCovered: 4, lineTotal: 5 },
    files: [{ filePath: 'com/example/Foo.java', lineCoverage: 80, lineCovered: 4, lineTotal: 5 }],
  };
  const c8 = {
    tool: 'c8',
    metrics: { lineCoverage: 75, lineCovered: 3, lineTotal: 4, methodCoverage: 100, methodCovered: 1, methodTotal: 1 },
    files: [{ filePath: 'src/app.js', lineCoverage: 75, lineCovered: 3, lineTotal: 4, methodCoverage: 100, methodCovered: 1, methodTotal: 1 }],
  };
  const out = CoverageNormalizer.normalize([jacoco, c8], { gitUrl: '', branchName: '', pipelineRunId: '', commitId: '' }, '');
  // 总体行覆盖率：(4+3)/(5+4) = 77.78%；可选指标不再输出
  assert.strictEqual(out.lineCoverage, 77.78);
  assert.strictEqual(out.methodCoverage, undefined);
  assert.strictEqual(out.fileDetails.length, 2);
});

test('CoverageNormalizer 路径归一化（仓库根前缀剥离）', () => {
  const parsed = {
    tool: 'go-test',
    metrics: { lineCoverage: 75, lineCovered: 3, lineTotal: 4 },
    files: [
      { filePath: '/builds/foo/openlibing/pkg/a.go', lineCoverage: 100, lineCovered: 2, lineTotal: 2 },
      { filePath: './openlibing/pkg/b.go', lineCoverage: 50, lineCovered: 1, lineTotal: 2 },
    ],
  };
  const out = CoverageNormalizer.normalize([parsed], { gitUrl: '', branchName: '', pipelineRunId: '', commitId: '' }, '/builds/foo');
  assert.strictEqual(out.fileDetails[0].filePath, 'openlibing/pkg/a.go');
  assert.strictEqual(out.fileDetails[1].filePath, 'openlibing/pkg/b.go');
});

test('CoverageNormalizer 无有效行数据抛错', () => {
  const parsed = { tool: 'c8', metrics: { lineCoverage: null, lineCovered: 0, lineTotal: 0 }, files: [] };
  assert.throws(() => CoverageNormalizer.normalize([parsed], { gitUrl: '', branchName: '', pipelineRunId: '', commitId: '' }, ''), /lineCoverage/);
});
