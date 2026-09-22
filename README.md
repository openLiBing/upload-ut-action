# upload-ut-action

单元测试（UT）覆盖率上报插件：扫描指定的覆盖率报告文件或目录，自动识别并解析主流工具的覆盖率报告，转换成平台标准格式后上报到 OpenLibing，方便在平台上集中查看各项目的 UT 覆盖率。

## 快速开始

在 workflow 里加一步即可：

```yaml
- name: Upload UT coverage
  uses: openlibing/upload-ut-action@v1
  with:
    report_dir: ./target/site/jacoco
```

插件内置华为云凭证换取能力，使用前只需在 workflow 顶层声明 `permissions: id-token: write`，无需额外安装认证插件。

## 支持的报告格式

| 工具 | 报告文件 |
| ---- | ---- |
| Java JaCoCo | `jacoco.xml` |
| Python coverage.py | `coverage.json` |
| Go test | `coverage.out`（`go test -coverprofile` 产物） |
| C/C++ gcov / llvm-cov | `*.gcov`、`*.lcov` / `*.info` |
| JS c8 | `coverage-final.json` |
| Rust cargo-llvm-cov | lcov（`--lcov`）或 llvm-cov export JSON（`--json`） |

`report_dir` 传文件或目录都可以（目录会递归扫描），多个路径用逗号分隔。个别文件（如 `coverage.json`）会自动按内容识别归属工具，不用手动区分。

行覆盖率所有工具都会上报；分支、方法、类覆盖率在工具支持时才会上报，未上报的指标平台侧不展示。

## 参数说明

| 参数 | 说明 | 必填 | 默认值 |
| ---- | ---- | ---- | ---- |
| `report_dir` | 覆盖率报告路径，文件或目录，逗号分隔可传多个 | 是 | - |
| `env_type` | 环境类型：`prod`（正式）/ `beta`（测试） | 否 | `prod` |
| `region` | 华为云区域 | 否 | `cn-southwest-2` |

## 输出

| 参数 | 说明 |
| ---- | ---- |
| `result` | 上报结果：`success` / `failed` |

## 完整示例

```yaml
- name: Upload UT coverage
  uses: openlibing/upload-ut-action@v1
  with:
    report_dir: ./target/site/jacoco, ./coverage
    env_type: prod
```

## 本地开发

```bash
npm install        # 安装依赖
npm test           # 运行单元测试
npm run build      # ncc 打包，产出 dist 和 zip
```
