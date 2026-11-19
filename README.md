# upload-ut-action

一个同时支持 GitCode（AtomGit）与 GitHub Actions 的 Action，用于扫描单元测试（UT）覆盖率报告，自动识别并解析主流工具的覆盖率格式，转换为平台标准数据后上报 OpenLibing，在平台上集中查看各项目的 UT 覆盖率。

## 功能特性

- 支持 6 种主流覆盖率报告：JaCoCo / coverage.py / Go test / gcov+llvm-cov / c8 / cargo-llvm-cov
- 报告格式自动识别，`report_path` 传文件或目录均可，目录递归扫描，逗号分隔支持多值
- 内置华为云凭证换取能力，无需额外安装认证插件
- 单份代码同时适配 GitCode Actions 与 GitHub Actions，按 `GITHUB_ACTIONS` 自动识别运行平台并选择对应的 OIDC 身份提供商与 OBS 桶

## 输入参数

| 参数          | 必填 | 默认值           | 说明                                                                                         |
| ------------- | ---- | ---------------- | -------------------------------------------------------------------------------------------- |
| `report_path` | 否   | -                | 覆盖率报告路径，文件或目录，逗号分隔可传多个；与 `report_dir` 皆缺时启动报错并指向本参数     |
| `report_dir`  | 否   | -                | 【已弃用】v1.0.1 前的旧输入名，等价于 `report_path`；`report_path` 优先，下个 major 版本移除 |
| `env_type`    | 否   | `prod`           | 环境类型：`prod`（正式）/ `beta`（测试）                                                     |
| `region`      | 否   | `cn-southwest-2` | 华为云区域                                                                                   |

> v1.0.1 起 `report_dir` 重命名为 `report_path`。**旧名仍可用但不推荐**（新名缺省时自动兜底并打印弃用警告），将于下个 major 版本移除，请尽快迁移：
>
> ```yaml
> # 旧写法（已弃用）        →  新写法
> report_dir: ./coverage/   →  report_path: ./coverage/
> ```
>
> 两者都未配置时启动报错，错误提示指向 `report_path`。

## 输出

| 输出         | 说明                                                             |
| ------------ | ---------------------------------------------------------------- |
| `result`     | 上报结果：`success` / `failed`                                   |
| `report_url` | 本次扫描记录的结果链接；后端未返回时为空（不输出） |

## 前置条件

工作流需要声明 OIDC 权限，用于华为云凭证换取（GitCode / GitHub 相同）：

```yaml
permissions:
  id-token: write # 必需
```

GitHub Actions 还需满足：

- Action 已发布到 GitHub 仓库，工作流通过 `<owner>/upload-ut-action@<tag>` 引用；
- 华为云 IAM 已注册 `GitHubActions` 身份提供商与 `github-actions` 信任委托（由平台运维配置）。

## 快速开始

### GitCode Actions

在 GitCode 项目的 `.gitcode/workflows/` 目录下创建工作流文件，例如 `ut-coverage.yml`：

```yaml
name: UT Coverage
on:
  pull_request:
    types: [open, update]

permissions:
  id-token: write

jobs:
  test:
    name: Test with coverage
    runs-on: [ubuntu-latest, x64, small]
    steps:
      - name: Checkout
        uses: checkout
      - name: Run tests with coverage
        run: |
          go test ./... -coverprofile=coverage.out
      - name: Upload UT coverage
        uses: openlibing/upload-ut-action@v1.0.1
        with:
          report_path: ./coverage.out
```

### GitHub Actions

在 GitHub 项目的 `.github/workflows/` 目录下创建工作流文件，例如 `ut-coverage.yml`：

```yaml
name: UT Coverage
on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write # 必需：OIDC 换证

jobs:
  test:
    name: Test with coverage
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests with coverage
        run: |
          go test ./... -coverprofile=coverage.out
      - name: Upload UT coverage
        uses: openlibing/upload-ut-action@v1.0.2 # 按 GitHub 实际发布地址替换
        with:
          report_path: ./coverage.out
```

说明：

- `report_path` 指向报告生成位置即可，仓库、分支、流水线等信息由平台自动注入，无需手动传入
- PR 事件按源分支归属数据：GitHub 取 `GITHUB_HEAD_REF` + `pull_request.head.sha`，GitCode 取 `ATOMGIT_HEAD_REF`，两个平台口径一致
- GitHub 上报到 `openlibing-github-action` 桶，GitCode 上报到 `openlibing-gitcode-action` 桶，对象 key 结构一致
- 未识别到任何报告时 step 仍以成功结束（仅记录告警），不影响流水线通过

### 支持的报告格式

| 工具                  | 报告文件                                            |
| --------------------- | --------------------------------------------------- |
| Java JaCoCo           | `jacoco.xml`                                        |
| Python coverage.py    | `coverage.json`                                     |
| Go test               | `coverage.out`（`go test -coverprofile` 产物）      |
| C/C++ gcov / llvm-cov | `*.gcov`、`*.lcov` / `*.info`                       |
| JS c8                 | `coverage-final.json`                               |
| Rust cargo-llvm-cov   | lcov（`--lcov`）或 llvm-cov export JSON（`--json`） |

`coverage.json` 等歧义文件会自动按内容识别归属工具，无需手动区分。

## 工作原理

1. 按 `GITHUB_ACTIONS` 识别运行平台，读取对应平台（GitHub / GitCode）的仓库、分支、运行 ID 等上下文
2. 扫描 `report_path` 定位报告并识别格式
3. 解析报告、转换为平台标准 JSON：行覆盖率必报，分支/方法/类覆盖率在工具支持时才上报
4. 使用 OIDC 临时凭证上传到平台对应 OBS 桶，并回调 OpenLibing 入库

## 本地开发

```bash
npm install        # 安装依赖
npm test           # 运行单元测试
npm run build      # ncc 打包到 dist/，并生成 upload-ut-action.zip
```

修改源码后需重新构建 `dist`，`action.yml` 中 `runs.main` 指向 `dist/index.js`。

## 版本发布

发布新版本时必须遵守：

- **版本号**：递增语义化版本，`action.yml` 与 `package.json` 保持一致
- **Tag 格式**：`v` + 版本号，如 `v1.0.0`。工作流通过 `uses: openlibing/upload-ut-action@v1.0.0` 引用，依赖该 tag 存在
- **发布明细**：创建 Release 时必须填写发布明细（变更内容、新增/修改的输入输出、兼容性说明等），不允许空明细发布

## 项目结构

```
upload-ut-action/
├── action.yml       # Action 元数据：输入、输出、运行入口
├── package.json     # 构建编排
├── index.js         # 主流程：扫描 → 解析 → 转换 → 上报
├── src/
│   ├── parser/      # 各工具报告的解析器
│   ├── normalizer/  # 标准 JSON 转换
│   ├── util/        # 平台判定等通用工具
│   └── obs/         # OBS 上传与平台回调
├── dist/
│   └── index.js     # ncc 打包产物，Action 实际运行此文件
└── README.md
```

## 参考文档

- [AtomGit Action 产品总览](https://docs.gitcode.com/docs/help/home/org_project/pipeline/overview)
- [工作流、任务、步骤和 Action](https://docs.gitcode.com/docs/help/home/org_project/pipeline/core-concepts/workflow-job-step-action)
- [触发事件](https://docs.gitcode.com/docs/help/home/org_project/pipeline/syntax-reference/trigger-events/)
- [变量（ATOMGIT_* 系统变量）](https://docs.gitcode.com/docs/help/home/org_project/pipeline/syntax-reference/variables)
- [Runner 镜像与预装工具](https://docs.gitcode.com/docs/help/home/org_project/pipeline/syntax-reference/runner-images-tools)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [GitHub Actions OIDC 权限](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
