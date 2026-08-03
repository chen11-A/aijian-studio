# 首个 8 周可调度 Backlog

估算单位为人日（PD），每人每两周最多计划 8 PD。W1 由技术负责人按实际到岗人数重算；任一职能超过 80% 容量时先移出非关键上游研究，不压缩恢复、安全和测试。

## 关键路径

```text
A02 Monorepo
  -> B01 基础类型
  -> B03 Artifact
  -> F01/F02/F03 最小状态机与本地执行器
  -> F06 故障注入
  -> K01 Walking Skeleton

E01/E02 来源摄取、M03 基础时间线、D01 桌面 IPC 安全并行汇入 K01。
```

## Sprint 1（W1–W2）

| ID  |  PD | DRI           | DependsOn | 交付物                                                                  | CI/验收                                |
| --- | --: | ------------- | --------- | ----------------------------------------------------------------------- | -------------------------------------- |
| A01 |   2 | Product Owner | -         | 已确认公开仓库 `chen11-A/aijian-studio` 与 Apache-2.0；产品展示名仍待定 | `repo-policy` 人工 Gate 已通过         |
| A02 |   5 | Tech Lead     | A01       | pnpm/uv Monorepo、锁文件、一键 dev                                      | `bootstrap-windows`, `bootstrap-linux` |
| A03 |   5 | DevOps Lead   | A02       | lint/typecheck/unit/build/license CI                                    | `ci-required`                          |
| A04 |   2 | Tech Lead     | A01       | ADR/PR/Issue/CODEOWNERS/Provenance 模板                                 | `docs-links`, `provenance-schema`      |
| B01 |   4 | Backend-1     | A02       | ID/Time/Money/Hash/Version JSON Schema                                  | `contracts-unit`                       |
| B03 |   6 | Backend-2     | B01       | ArtifactVersion/Head/DependencyEdge                                     | `domain-unit`                          |
| M01 |   4 | Media-1       | A02       | Rational timebase/CFR/VFR/48kHz 契约                                    | `media-contract`                       |
| M02 |   6 | Media-2       | M01       | FFmpeg/播放/代理 Spike 与黄金媒体                                       | `media-fixtures`                       |
| Q01 |   5 | SDET-1        | M01       | `quality-baseline-v0`、fixture hash                                     | `quality-baseline`                     |
| Q02 |   5 | SDET-2        | A02       | Hello Desktop 测试安装包、Win11 标准用户                                | `package-smoke`                        |
| C01 |   4 | Film Producer | -         | 黄金短篇、held-out 短篇、权利证据                                       | `content-fixture-audit`                |
| C02 |   6 | Head Writer   | C01       | 5万/15万/30万字资格语料与人工标注计划                                   | `corpus-manifest`                      |

Sprint 1 Gate：术语/演进规则冻结；参考硬件、指标、命令和阈值有版本；时间线不得使用浮点秒。

## Sprint 2（W3–W4）

| ID  |  PD | DRI           | DependsOn | 交付物                                          | CI/验收                         |
| --- | --: | ------------- | --------- | ----------------------------------------------- | ------------------------------- |
| F01 |   5 | Workflow-1    | B03       | Workflow/Node/Attempt 最小 Schema               | `workflow-unit`                 |
| F02 |   6 | Workflow-1    | F01       | 状态转换、租约、唯一领取                        | `workflow-race`                 |
| F03 |   7 | Backend-1     | F02       | SQLite Task Ledger + LocalExecutor              | `executor-recovery`             |
| F06 |   5 | SDET-1        | F03       | Fake Provider、错误和崩溃注入                   | `fault-injection`               |
| E01 |   5 | Backend-2     | B03       | TXT 摄取、原文件 hash、最小 SourceBlock         | `ingest-unit`                   |
| D01 |   7 | Desktop-1     | A02       | Electron main 启动 sidecar、随机端口/令牌       | `desktop-lifecycle`             |
| D02 |   5 | Security Lead | D01       | `app://aijian`、IPC transport、严格 Host/Origin | `localhost-security`            |
| D03 |   4 | Frontend-1    | D02       | Web HTTPS transport 与工作区连接抽象            | `transport-contract`            |
| P01 |   6 | AI-1          | B01       | OpenAI/xAI 文本限额真实 Spike                   | `provider-live-text`（受保护）  |
| P02 |   8 | AI-2          | B01       | image/video/TTS 真实异步 Spike                  | `provider-live-media`（受保护） |
| U01 |   5 | Architect     | A04       | Jellyfish/LumenX/Wind/Toonflow 等取舍与许可证   | `upstream-gate`                 |
| U02 |   4 | Media-1       | M02       | HyperFrames 确定性渲染基准                      | `hyperframes-spike`             |
| R01 |   4 | Architect     | F03,D01   | 迁移/恢复 ADR、四种退出语义                     | `adr-check`                     |

Sprint 2 Gate：Renderer 无端口/令牌/密钥；真实视频能进入 `REMOTE_UNKNOWN` 且不自动重提；上游形成固定提交的“复用/重写/拒绝”结论。

## Sprint 3（W5–W6）

| ID    |  PD | DRI         | DependsOn              | 交付物                                     | CI/验收                  |
| ----- | --: | ----------- | ---------------------- | ------------------------------------------ | ------------------------ |
| M03   |   8 | Media-1     | M01,M02                | trim/reorder/replace/代理/1080p 导出       | `timeline-golden`        |
| UI01  |   8 | Frontend-1  | D03,E01                | 创建项目、导入、任务、基础时间线 UI        | `web-e2e-skeleton`       |
| API01 |   6 | Backend-2   | E01,F03                | Skeleton API 与 OpenAPI 生成客户端         | `openapi-drift`          |
| K01   |   8 | Tech Lead   | F03,F06,M03,UI01,API01 | 2万字→Fake 资产→MP4 纵切                   | `walking-skeleton`       |
| Q03   |   8 | SDET-1      | K01                    | 六 kill 点×100 种子                        | `kill-matrix`            |
| Q04   |   7 | SDET-2      | Q02,K01                | 干净 Win11 中文用户名/长路径/Defender 安装 | `package-windows-matrix` |
| D04   |   4 | Desktop-2   | D01                    | 托盘/退出/远程轮询/异常恢复                | `desktop-lifecycle`      |
| C03   |   5 | Film Editor | K01                    | 只用 UI/API 完成黄金纵切并记录 workaround  | `film-skeleton-report`   |

Sprint 3 Gate：开发者不得手改数据库；六个 kill 点 60 秒内可解释恢复，Artifact hash 不变、未知远程不重提、最终继续导出；v0 Schema 冻结。

## Sprint 4（W7–W8）

| ID    |  PD | DRI             | DependsOn     | 交付物                                        | CI/验收                    |
| ----- | --: | --------------- | ------------- | --------------------------------------------- | -------------------------- |
| E02   |   8 | Backend-2       | E01           | TXT/MD/DOCX、UTF-8 字节 SourceSpan、raw map   | `ingest-formats`           |
| E03   |   7 | Frontend-2      | E02           | 章节校对/原文阅读/10万块虚拟列表              | `source-ui-e2e`            |
| F04   |   6 | Workflow-1      | F02,B03       | Gate/ApprovalDecision/accepted head           | `approval-contract`        |
| F05   |   8 | Workflow-1      | F04           | typed DAG、blocking/advisory/render-only 失效 | `invalidation-golden`      |
| F07   |   5 | Backend-1       | F03           | `SUBMIT_INTENT`/预算预留/对账状态             | `remote-unknown`           |
| S01   |   6 | Security Lead   | D02,E02       | SSRF/Zip Slip/恶意媒体/假密钥扫描骨架         | `security-phase0`          |
| R02   |   6 | Backend-1       | R01           | 迁移快照、N/N-1/N-2、只读拒绝                 | `migration-matrix`         |
| CAS01 |   6 | Media-2         | M02           | temp→hash verify→atomic rename、本地 GC 基础  | `cas-crash`                |
| Q05   |   8 | SDET-2          | F05,R02,CAS01 | 磁盘满/备份坏/更新中断/回滚矩阵               | `recovery-matrix`          |
| C04   |   5 | Continuity Lead | E02,F05       | 黄金 Canon/影响变更集和漏失效判据             | `film-invalidation-report` |

## W8 退出条件

- 可安装桌面壳和远程 Web transport 共享同一 OpenAPI 契约，Renderer 不持有本地服务或供应商凭据。
- 黄金短篇可摄取为稳定 SourceSpan；Python/TypeScript 对中文、emoji、规范化字符坐标一致。
- Agent/Fake Provider 先创建不可变草稿版本，再经 Gate 推进 accepted head。
- 强杀、磁盘满、更新中断和备份损坏后，没有静默丢数据、不可解释任务或未知状态自动重提。
- 修改黄金输入会得到正确影响报告，漏失效为 0，人工后代不被覆盖。
- 安装包拥有 SBOM/NOTICE/第三方来源清单，未混入 AGPL/GPL/no-license 代码。
- Sprint 5–12 的 Issue 已带 DRI、PD、依赖、CI lane 和影片验收；关键路径容量不超过 80%。
