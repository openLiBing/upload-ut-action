# upload-ut-action

## 简介

单元测试（UT）覆盖率上报插件：扫描用户指定的覆盖率报告目录，自动识别并解析 6 种主流工具的报告格式（Java jacoco / Python coverage.py / Go test / C/C++ gcov+llvm-cov / JS c8 / Rust cargo-llvm-cov），转换为 OpenLibing 平台的标准 JSON 后上传 OBS，并通过 APIG 网关回调通知 coderepo 服务异步导入。

- **插件名**: `upload-ut-action`
- **认证模式**: OIDC 联邦认证（免静态 AK/SK），插件内嵌 `@openlibing/huaweicloud-oidc-client` SDK 自申请 OIDC ID Token + 华为云 STS 换证，无需额外运行 `huaweicloud-oidc-auth` 插件

## 支持的报告格式

| 工具 | 报告文件 | 解析器 |
| ---- | -------- | ------ |
| Java JaCoCo | `jacoco.xml` | `src/parser/JacocoParser.js` |
| Python coverage.py | `coverage.json` | `src/parser/CoveragePyParser.js` |
| Go test | `coverage.out`（`go test -coverprofile`） | `src/parser/GoTestParser.js` |
| C/C++ gcov | `*.gcov` / lcov（`*.lcov` / `*.info`，geninfo 或 llvm-cov `--format=lcov` 产出） | `src/parser/GcovParser.js` |
| JS c8 | `coverage-final.json` | `src/parser/C8Parser.js` |
| Rust cargo-llvm-cov | lcov（`--lcov`）或 llvm-cov export JSON（`--json`） | `GcovParser` / `CargoLlvmCovParser.js` |

> `coverage.json` 等歧义 JSON 会自动内容嗅探：llvm-cov export（顶层 `data` 数组）→ cargo-llvm-cov；coverage.py（`meta/files/totals`）→ coverage-py；c8（`statementMap`）→ c8。

## 指标约定

- **行覆盖率（lineCoverage）**：唯一必填指标，所有工具均产出。
- **分支/方法/类覆盖率（branchCoverage / methodCoverage / classCoverage）**：可缺省。工具不支持时不传，后端存 NULL，平台页面不展示该指标。
  - coverage.py / go test：无 branch/method/class 时自动缺省
  - c8：提供 line + branch + method（函数）
  - cargo-llvm-cov：rust 某些 target 的 branches 为 null，自动缺省

## 前置要求

Workflow 声明 `permissions: id-token: write`，插件内嵌 SDK 自动换证，**无需运行 `huaweicloud-oidc-auth` 插件**：

```yaml
permissions:
  id-token: write
```

## 输入参数

| 参数 | 说明 | 必填 | 默认值 |
| ---- | ---- | ---- | ------ |
| report_dir | 覆盖率报告路径：单个文件或目录（目录递归扫描），逗号分隔支持多值 | 是 | - |
| env_type | 环境类型：`prod`（正式环境）/ `beta`（测试环境） | 否 | `prod` |
| region | 华为云区域（优先此参数，其次环境变量 `CLOUD_REGION`/`REGION_ID` 等，默认 `cn-southwest-2`） | 否 | - |

## 输出参数

| 参数 | 说明 |
| ---- | ---- |
| result | 上报结果：`success` 或 `failed` |

## OBS 路径规则

标准 JSON 上传到统一桶的固定前缀，对象公共读（后端匿名 HTTP GET 下载）：

```
obs://openlibing-gitcode-action/ut-coverage-action/{repoName}/{yyyyMMdd}.{HH}/{pipelineRunId|manual}/ut-coverage.json
```

## 回调

OBS 上传成功后通过 APIG 网关回调（V11-HMAC-SHA256 签名 + `X-Security-Token`）：

```
POST {apig-domain}/action-api/ut/coverage/report
{ "gitUrl": "...", "branchName": "master", "pipelineRunId": "123", "obsUrl": "https://..." }
```

- OBS 上传与 APIG 回调均**指数退避重试（默认 3 次）**
- 回调失败不阻断流程：OBS 已上传，数据可后续补导入

## 示例

```yaml
- name: Upload UT coverage
  uses: openlibing/upload-ut-action@v1
  with:
    report_dir: ./target/site/jacoco
    env_type: prod
```

## 本地开发

```bash
npm install        # 安装依赖
npm test           # 运行单元测试（node --test）
npm run build      # ncc 打包 dist + 生成 zip
```

## 目录结构

```
upload-ut-action/
├── index.js                       # 主流程（扫描 → 解析 → 转换 → 上传 → 回调）
├── action.yml                     # Action 定义
├── src/
│   ├── parser/
│   │   ├── ReportScanner.js       # 目录扫描 + 扩展名/内容识别
│   │   ├── JacocoParser.js
│   │   ├── CoveragePyParser.js
│   │   ├── GoTestParser.js
│   │   ├── GcovParser.js          # lcov + 纯 .gcov 文本
│   │   ├── C8Parser.js
│   │   └── CargoLlvmCovParser.js  # llvm-cov export JSON
│   ├── normalizer/CoverageNormalizer.js  # 合并/路径归一化/标准 JSON
│   ├── obs/ObsUploader.js         # OIDC 换证 + OBS 上传 + APIG 回调
│   └── util/                      # fetch polyfill / 覆盖率计算工具
└── test/                          # 单元测试 + fixtures
```
