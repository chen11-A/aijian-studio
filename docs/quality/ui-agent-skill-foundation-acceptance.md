# UI + Agent + Skill 基础验收清单

状态：In progress；Fake `source.extract` 已具备 Electron 启动、后台执行、提案读取与接受/退回，提案比较和人工 Gate 联合纵切仍未完成

当前纵切证据：Migration 12/13 分别建立接受与退回的不可变审计，Migration 13 再把两类决定扩展为双向互斥；Sidecar-only Worker/决定事务、Electron exact-key IPC、持久 operation journal 和提案卡共同跑通 `source.extract`。创建运行只允许内置 Fake 定义，首次 IPC 前保存精确 `operation_id + input`；`REMOTE_UNKNOWN` 只能显式恢复同一操作，明确结果才清理 journal。真实 Electron 故障注入已在 Sidecar 返回 `201` 后丢失首个响应，Renderer 保留未知状态；重启后使用完全相同的 operation/input 获得 `200` replay，最终数据库仍只有一个 Workflow、Attempt、Task、enqueue intent 和 Proposal。Worker 生成带 SourceSpan、零费用和显式能力损失的 ArtifactProposal；接受只创建 DRAFT 且不推进 accepted Head 或 Gate。隔离纵切及数据库不变量见 [结构化结果](evidence/proposal-run-electron-smoke.json) 与 [1440×920 截图](evidence/proposal-run-electron-1440x920.png)。普通 Web 没有创建/决定 capability，390px 不渲染这些控件。真实远程 Provider 的 `REMOTE_UNKNOWN`、影片验收、提案比较和人工 Gate 仍未完成，本增量不提高 48 周路线图完成度。

## C：P0 UI 壳

- [ ] 一级导航严格为项目、故事、导演、资产、生成、剪辑、发布；任务为抽屉，模型与 API 在设置。
- [ ] G0–G8 显示状态、阻塞、审批人、预计费用和唯一下一步。
- [ ] 1440×900 三栏与任务抽屉无整页溢出；编辑器默认折叠项目栏。
- [ ] 980px 可完整审阅提案、证据、diff 和 Gate。
- [ ] 390px 只能审片、评论、接受/退回和审批，无法进入复杂画布/时间线。
- [ ] 提案卡展示 SourceSpan、diff、影响 Artifact、费用、置信度、能力损失和三种操作。
- [x] 接受提案的界面明确写“形成 DRAFT”，不把 Agent PASS 显示成人工批准。
- [ ] 空、载入、错误、离线、无权限、预算不足和能力降级状态均有真实 fixture。
- [ ] 现有 API、项目导入、Provider 设置、任务队列和时间线测试无回归。

## D：Agent/Skill Fake Runtime

- [ ] 六类核心合同均版本化并有 Python/JSON Schema/生成 TypeScript 测试。
- [ ] Attempt 完整指纹固定 agent/skill/prompt/policy/provider/model/能力/输出 Schema 版本与输入哈希；任一执行决定变化不会误复用。
- [ ] Registry 拒绝未知、禁用或版本不兼容的 Agent/Skill。
- [ ] ContextManifest 严格按五层装配，小说和外部响应不能提升信任级。
- [ ] Agent 只提交 ArtifactProposal，没有数据库写权限。
- [ ] 缺 SourceSpan、Schema 非法、预算不足、引用未批准资产时失败关闭。
- [x] 接受提案只创建不可变 DRAFT；Gate 继续使用具名人类 review/approval。
- [ ] 同完整 `attempt_fingerprint` 重复启动不重复计费、不创建冲突版本。
- [ ] 取消、崩溃恢复、并发领取、租约过期和幂等可证明。
- [ ] 自动 QC 失败最多重试一次；`REMOTE_UNKNOWN` 永不自动重提。
- [ ] Electron preload 新增方法采用精确白名单和合同测试；Renderer 不持有 token/密钥。
- [ ] 数据库迁移有升级、回滚/恢复快照和旧项目重开测试；不手改 SQLite。
- [ ] 每个新增 API 有路由/权限/错误/幂等合同测试，OpenAPI drift 与生成 TypeScript 类型通过。
- [ ] ArtifactProposal 卡片有空、载入、错误、证据、diff、费用、接受 DRAFT、退回和比较组件测试。
- [ ] 匿名 Web 对 Agent/Proposal 写接口返回 401/403；D 阶段不借现有开发写路由扩大权限。
- [ ] 全过程只使用 Fake Agent/Skill/Provider，不发生真实付费调用。

## 联合纵切

- [ ] 1440×900 Electron：项目→阶段条→启动 Fake Agent→提案→接受 DRAFT→人工批准→下游页面。
- [ ] 1440×900 匿名 Web：真实 API 读取同一运行/提案，写按钮禁用且直接 POST 失败关闭；无横向溢出、无控制台错误。
- [ ] 服务器身份落地后，已认证 Producer/Reviewer Web 会话另行完成与 Electron 相同的完整写纵切；在此之前不能宣称 Web 写闭环完成。
- [ ] 同一授权小说完成 3 镜头/15 秒 Fake 纵切并记录人工修复分钟、重生成率、费用和阻塞。
- [ ] 控制台无错误、无整页横向溢出、刷新/重启后状态一致。
- [ ] 定向测试、相关全量测试、类型检查、lint、build、真实 E2E、独立代码审查全部通过。

## 非验收项

规格和 UI 壳存在不等于 Agent Runtime 完成；Fake Runtime 通过不等于 GPT/xAI Provider 合格；Agent QC 通过不等于具名人类 Gate 通过。未经相应证据，不上调 48 周路线图完成度。
