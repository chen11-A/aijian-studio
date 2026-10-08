# 新建项目交互任务

## 目的与边界

本文定义桌面 UI 在“新建项目”提交后的用户可见状态，并给出后端负责人可共同实施的最小接线范围。目标是让用户能区分成功、提交中、明确失败和结果未知；不改变 H87 选定布局、页面结构或新建项目入口。

本文不判断 run3 的后台根因，也不把 UI 证据当作 C3 原生验收。当前产品候选工作区仍是 `C:\Users\Administrator\Documents\sp\.cache\aivora-worktrees\only-ui-product-20260910`。

## 当前交互事实

- `HomePages.tsx` 的 `newProject` 通过 `d.edit` 打开对话框。保存回调校验工作区连接和标题后，以 `void d.createRealProject(...)` 启动异步创建；只有 `SUCCEEDED` 才导航到来源页。
- `Common.tsx` 的 `EditorDialog` 在 `save` 未返回 `false` 时立即执行 `d.setEditor(null)`。因此异步请求开始后，对话框关闭，提交中和结果未知都没有持久的对话框状态。
- `model.tsx` 的 `createRealProject` 以 ref 防止同一会话内重复提交：`createPending` 阻止并发调用，`createUnknown` 阻止未知结果后的自动再次提交。两者只存在于内存中。
- `projectWorkspace.ts` 的 `createWorkspaceProject` 将异常和不可用响应统一返回 `REMOTE_UNKNOWN`，当前 UI 只收到一条短时 toast：`创建结果未知。请刷新项目列表后确认，未自动重试。`。
- run3 的保留证据显示：提交后对话框已关闭，本地工作区已连接，项目表仍显示“还没有项目”，runner 在等待新项目选项时超时；没有保留 create 返回值、Renderer error、bridge/API 错误或 `listProjects` 读回结果。因此只能确认“提交后未观察到项目选项”，不能确认具体根因。

## 四种用户可见状态

状态必须绑定同一个创建意图和输入摘要。刷新、切页或重新打开 UI 后，若本地仍有未决意图，先显示该意图的状态，不生成第二次创建。

| 状态 | 进入条件 | 用户看到的内容 | 允许的操作 | 禁止的行为 |
| --- | --- | --- | --- | --- |
| 成功 `SUCCEEDED` | 收到合同有效的成功响应，并取得项目 ID/名称 | 对话框关闭；toast 显示“项目已创建”；项目进入项目列表并成为当前项目；随后按现有流程进入来源页 | 打开项目、继续来源导入 | 在项目列表读回前显示成功项目 |
| 提交中 `SUBMITTING` | 已持久化创建意图，正在等待明确响应 | 对话框保持打开或显示不可编辑的提交面板；主按钮显示“正在创建”；说明“请等待结果，不要重复提交” | 关闭视图但保留任务；返回后继续查看状态 | 再次发送相同或新建请求；用超时直接判定失败 |
| 明确失败 `FAILED` | 收到合同有效的拒绝/4xx，且服务端明确未创建 | 对话框保留标题和故事灵感；`role=alert` 显示可理解原因；主按钮显示“修改后重试”或“重试创建” | 修改输入后重新提交；关闭并保留错误记录 | 把连接失败、解析失败或超时显示成明确失败 |
| 结果未知 `REMOTE_UNKNOWN` | 超时、连接断开、进程中断、响应损坏或无法确认服务端是否已受理 | 显示持久警告：“创建结果未知。请刷新项目列表确认；不会自动重试。”；保留原输入和 operation ID 的可追踪摘要 | “刷新项目列表”；确认已存在时打开项目；确认不存在后由用户显式选择“按原请求恢复”或“标记已取消” | 自动重提、静默清除意图、允许普通“新建项目”绕过未决意图 |

### 状态转换约束

`SUBMITTING` 只能转换到 `SUCCEEDED`、`FAILED` 或 `REMOTE_UNKNOWN`。`REMOTE_UNKNOWN` 只能通过项目列表读回或用户明确的恢复/取消动作结束；列表读回没有明确匹配时仍保持未知，不得直接创建新的 attempt。成功后以服务端项目 ID 去重，不能依赖本地数组序号。

## 当前缺口

### 持久错误

错误只有 toast，4.5 秒后消失；EditorDialog 又已关闭。刷新或重新进入项目中心后，用户无法知道上次提交的标题、operation ID、最终状态或下一步。`REMOTE_UNKNOWN` 仅存于 `createUnknown.current`，应用重启后丢失，无法完成 run3 要求的恢复和证据采集。

### 防重复操作

内存 ref 能挡住同一 Renderer 会话中的并发调用，但没有 UI 的提交中禁用态，也没有跨刷新/重启的持久 operation journal。用户可在状态丢失后再次发起同名或同输入创建；当前 UI 没有把“相同意图”与服务端幂等键绑定的可见状态。

### 可恢复操作

未知结果只有提示“刷新”，但没有把刷新结果与原创建意图关联，也没有显示匹配项目、无匹配或读回失败三种结果。明确失败没有保留表单以便修正；提交中关闭后没有恢复入口；项目列表读回也没有把服务端项目 ID、原始 operation 和本地记录合并展示。

### 证据缺口

run3 没有取得结构化 create outcome、提交后的立即 `listProjects` 快照或 Renderer 错误记录。下一次获准运行时，runner 应继续通过对话框提交，并记录这三类观测；不能改为直接调用 bridge 来替代 UI 流程。

## 最小修改范围

只涉及新建项目的状态接线，不调整 H87 布局、导航入口、字段顺序或 CSS：

1. `apps/studio-web/src/aivora/model.tsx`：把创建状态从内存 ref 提升为可渲染状态；为每次提交生成并持久化 `{ operation_id, input_fingerprint, state }`，在明确成功/明确失败/用户确认取消后更新或清理。
2. `apps/studio-web/src/aivora/adapters/projectWorkspace.ts`：区分合同有效的明确失败与 `REMOTE_UNKNOWN`；保留服务端项目 ID、operation ID 和可用于列表对账的输入指纹。不得把异常改判为明确失败。
3. `apps/studio-web/src/aivora/HomePages.tsx`：让新建项目提交显示提交中、明确失败和未知结果；成功仍沿用现有 `d.go("source")`。未知状态只提供刷新/核对和显式恢复，不自动重提。
4. `apps/studio-web/src/aivora/Common.tsx`：仅增加 EditorDialog 对“提交中/错误后保留表单”的受控显示能力；保留现有关闭和未保存修改确认行为。
5. 如需持久化工具，新增一个与 workspace selection 同级、仅存创建意图的 adapter；不改数据库 schema，不引入依赖，不让 Renderer 读取端口、令牌或密钥。

不在本任务范围内：后端根因修复、runner 解冻、延长 selector 轮询、全量测试、产品进程启动、真实 Provider 接入、布局重构和其他页面创建流程。

## 交互检查（3–5 项）

1. **成功**：在已连接工作区打开“新建项目”，填写合法标题并提交；断言按钮进入提交中且只发送一次，收到有效成功响应后对话框关闭，项目以服务端 ID 出现在列表，并按现有流程进入来源页。
2. **明确失败**：让创建接口返回合同有效的拒绝；断言对话框不丢失标题/灵感，错误以 `role=alert` 持久显示，用户修改后可再次提交，且此前失败意图不阻止新请求。
3. **结果未知**：让创建请求超时或丢失响应；断言显示持久未知状态、保留原 operation/input 摘要、不自动重提；普通“新建项目”入口被锁定或明确引导先处理该未知意图。
4. **未知结果恢复**：在未知状态下刷新项目列表；分别验证找到匹配服务端项目时可确认并打开、没有匹配时仍不自动重提且可由用户显式恢复同一 operation、列表读取失败时保留未知并报告读取失败。
5. **重启/重复提交**：提交中或未知状态后重新加载 Renderer；断言持久记录恢复，重复点击不会生成第二次请求；成功项目再次读回时按服务端 ID 合并，不产生重复卡片。

## 验收边界

上述交互检查只能证明 UI 状态呈现、持久意图和调用次数；它们不证明真实 Electron、SQLite、服务端迁移、Provider 受理或 C3 完整正常路径。任何 run3/run4 结果仍需独立保留原始日志、截图和失败边界。

## 证据索引

- UI：`C:\Users\Administrator\Documents\sp\.cache\aivora-worktrees\only-ui-product-20260910\apps\studio-web\src\aivora\HomePages.tsx`
- 对话框：`C:\Users\Administrator\Documents\sp\.cache\aivora-worktrees\only-ui-product-20260910\apps\studio-web\src\aivora\Common.tsx`
- 状态模型：`C:\Users\Administrator\Documents\sp\.cache\aivora-worktrees\only-ui-product-20260910\apps\studio-web\src\aivora\model.tsx`
- 创建适配器：`C:\Users\Administrator\Documents\sp\.cache\aivora-worktrees\only-ui-product-20260910\apps\studio-web\src\aivora\adapters\projectWorkspace.ts`
- run3 诊断：`C:\Users\Administrator\.codex\worktrees\fb64\sp\.aijian-dev\controller-audit-20260910\c3-e3-native-project-create-diagnosis-20260917\diagnosis.md`
- run3 外层结果：`C:\Users\Administrator\.codex\worktrees\fb64\sp\.aijian-dev\controller-audit-20260910\c3-e4-native-normal-run3-20260917\outer-result.json`
