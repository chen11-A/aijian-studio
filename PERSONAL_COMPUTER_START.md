# 在个人电脑继续 AIVORA

## 获取仓库

在个人电脑选一个空的开发目录，在 PowerShell 执行：

```powershell
git clone --branch main https://github.com/chen11-A/aijian-studio.git
Set-Location aijian-studio
git status --short
git log -1 --oneline
```

私有仓库需要使用有访问权限的 GitHub 账号登录。正常 clone 后工作树应为空；若有既有本地修改，不要用 reset --hard 覆盖。

## 先读这些资料

1. [开发交接](DOTS_HANDOFF.md)。
2. [完整产品需求与验收基线](docs/product/AIVORA-完整产品需求与验收基线.md)。
3. [受保护版本排除及旧版保留清单](handoff/2026-10-08/TRANSFER-EXCLUSIONS.json)。

此快照排除了 399 个受保护文件版本。两个核心文件保留旧版，另一个核心文件缺失。尚未通过完整构建或运行验证，不直接导入真实数据库，不启动付费生成任务。

## 开发环境

仓库声明 Node.js 24、pnpm 11.9.0、Python 3.12；使用 uv 管理 Python 依赖。以当前 package.json、pyproject.toml 和锁文件为准。在个人电脑安装相应工具后，于仓库根运行：

```powershell
pnpm install --frozen-lockfile
uv sync --frozen
```

这些命令是接手操作说明，本次未在个人电脑执行验证。依赖失败时保留错误，先确认版本和网络，不盲目重写锁文件。

先让开发对话按交接说明修复缺失模块、旧后端与新合同的不一致，再运行针对性测试、`pnpm typecheck`、`pnpm build`。达到可启动条件后再执行 `pnpm dev`。真实 Sub2API、媒体工具链、凭据与安装资源需要另行配置。

这台公司电脑上不再继续功能开发；原文件和暂存区保留作为受控原始记录，不要求从它提取受保护源码。
