# 贡献指南

项目仍处于 Phase 0。任何功能代码合并前必须有对应需求/ADR、测试和许可证来源说明。

## 变更流程

1. Issue 写清用户问题、范围、非目标和验收标准。
2. 公共契约、数据迁移、安全边界或新依赖必须先提交 ADR/设计说明。
3. 先写失败测试或可复现夹具，再做最小实现。
4. PR 同时更新文档、迁移、权限、日志脱敏和失败恢复测试。
5. 代码审核与电影流程验收分开：测试通过不等于镜头/剧本质量通过。

## 工程规范

- 所有变更遵循 [编码规范](docs/development/coding-standards.md)。
- 所有用户界面遵循 [UI 工程规范](docs/development/ui-engineering-standards.md)，并经过真实浏览器验收。
- 提交前运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`。
- 评审覆盖正确性、可读性、架构、安全和性能五个维度；Critical/Important 问题解决前不得合并。

## 上游代码

不要直接从 GitHub 复制代码片段。先在 Issue 记录仓库 URL、固定提交、文件、SPDX 许可证、NOTICE 和采用理由，再更新 `third_party/provenance.yml`。AGPL/GPL、无许可证、非商业条款或源码不完整的项目不能进入 Apache 核心。

## 安全

不要在 Issue、日志、测试夹具或提交中放真实 API Key、浏览器 Cookie、签名 URL、未授权小说或人物素材。安全问题应走仓库启用后的私密漏洞报告渠道。
