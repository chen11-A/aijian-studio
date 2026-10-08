# 新建项目后 UI 不显示项目：只读诊断

日期：2026-09-17  
范围：仅审计 A 的 C3 run3 证据与正式产品根 P 的创建链路；未修改 P，未运行 P、Electron、API、SQLite 或全量测试。

## 1. 用户可见问题

在项目中心点击“新建项目”，填写作品名称并保存后，弹窗关闭；项目表仍显示“还没有项目”，随后 runner 在等待同名 `option` 时 30 秒超时。

run3 的事实是：`createProjectThroughUi` 在等待新项目 option（runner `electron-c3-native-readiness.mjs:830-833`）失败；截图显示提交后的项目中心仍为空。该事实不能证明 API、IPC、数据库或 listProjects 本身失败。

## 2. 代码链路与证据

调用链为：

`HomePages.tsx` 新建表单 → `model.tsx:createRealProject` → `adapters/projectWorkspace.ts:createWorkspaceProject` → `StudioTransport.createProject` → `apps/desktop/src/preload.ts` → `apps/desktop/src/main.ts` IPC `projects:create` → `api-client.ts` POST `/api/v1/projects` → API `main.py` POST `/api/v1/projects` → `repository.py:create_project` 写入 projects/默认 episode。

已核对的静态事实：

1. `HomePages.tsx:24-40` 的保存回调以 `void d.createRealProject(...)` 启动异步请求，只在结果为 `SUCCEEDED` 时导航到 source；提交回调本身不等待结果。
2. `Common.tsx:237-238` 在 `editor.save?.(data)` 返回非 `false` 后立即执行 `d.setEditor(null)`。因此新建项目请求尚未完成时对话框必然关闭，失败也不会阻止关闭。
3. `projectWorkspace.ts:30-37` 捕获所有异常并统一返回 `{ kind: "REMOTE_UNKNOWN" }`，丢失异常类型、HTTP 状态、request_id 和响应校验失败原因。
4. `model.tsx:758-799` 在非成功结果时只设置 `createUnknown` 并显示短暂通知；成功时才把返回项目插入本地 `projects` 状态。没有持久的创建状态/结果可供 UI 或 runner 读取。
5. `preload.ts:86-89`、`main.ts:123-125` 的项目 list/create IPC 映射存在；`api-client.ts:2443-2451` 明确分别 GET/POST `/api/v1/projects` 并做响应契约校验。
6. API `main.py:757-781` 将 list/create 路由接到 repository；`repository.py:1221-1281` 插入 project、默认 episode 后提交，并按 `updated_at DESC, id ASC` 列表读取。仅凭源码不能判定本次运行是否走到这些行。

## 3. 确定缺陷、疑点与已排除项

### 确定缺陷

创建是 fire-and-forget，且表单关闭与异步结果脱钩；所有创建异常又被压成不可区分的 `REMOTE_UNKNOWN`。这确定造成“用户看不到真实结果、runner只能看到空表/超时”的可观测性缺陷，也是下一包应先修的产品问题。

### 仍未确定的根因

run3 证据没有 create 返回值、renderer rejection/console、IPC/API 状态与 request_id、创建后 authoritative `listProjects` 读回，因此以下可能性尚未区分：

- API POST 未发出或 IPC 处理失败；
- POST 返回 HTTP/契约错误，被 desktop client 或 adapter 吞掉；
- repository 写入失败或事务回滚；
- 创建成功但 renderer 未更新项目状态；
- runner 的 option 选择器/时序观察问题。

### 已排除/不能归因的项

- 已排除本轮失败是 launcher/main PID、preload bridge 或正常退出问题：run3 对这些切片有独立通过证据。
- 不能声称“后端持久化失败”或“listProjects 读回失败”：run3 在 option 等待处停止，后续 readback 未执行。
- 不能用增加等待时间、直接调用 bridge、伪造项目 option 或改 runner 来绕过问题。

## 4. 最小可观测真实交互

只需一次真实 UI 交互，使用一个唯一名称，例如 `诊断项目-<runId>`：

1. 从正式 UI 连接本地工作区，进入项目中心；记录提交前 `listProjects` 的完整响应（至少 `data`、`request_id`）。
2. 通过“新建项目”填写唯一名称并点击保存；记录单调时间戳 `t_submit`。
3. 在同一 renderer 记录：创建 promise 的最终结果或异常、提交后页面/项目表文本、持久 toast/错误状态及 console error。
4. 在 desktop/API 边界按同一请求关联记录：`projects:create` 是否到达、HTTP 状态、响应 `request_id`/错误码；随后立即调用一次 `listProjects`，记录完整响应与 `t_readback`。
5. 仅当上述结果表明 POST 成功但 UI 空时，再检查对应 SQLite 项目行；不要先把数据库检查当作根因证据。

这一次交互必须仍从对话框提交，不得直接调用 bridge/API；保留失败原始证据。

## 5. 下一包拟修改文件（得到具名实施指令后）

第一优先级的产品修复候选：

- `apps/studio-web/src/aivora/HomePages.tsx`：把创建提交纳入可等待的 UI 状态，不再以无法观测的 `void` 触发；成功后显示项目并导航，失败保留对话框/显示明确失败状态。
- `apps/studio-web/src/aivora/model.tsx`：增加结构化、持久到本次页面生命周期的 create 状态/结果，区分 `PENDING`、`SUCCEEDED`、`REMOTE_UNKNOWN`，并避免重复提交。
- `apps/studio-web/src/aivora/adapters/projectWorkspace.ts`：在不泄露凭据/响应正文的前提下保留可诊断的错误类别、status、request_id；不要把未知结果转换成成功。

配套测试候选：

- `apps/studio-web/src/aivora/HomePages.test.tsx`
- `apps/studio-web/src/aivora/workspace-flow.test.tsx`
- 必要时 `apps/studio-web/src/aivora/adapters/projectWorkspace.test.ts`（若已有同目录测试则扩展原测试）

只有在一次观测明确定位到边界故障时，才扩大到 `apps/desktop/src/api-client.ts`、`preload.ts`、`main.ts` 或 `services/api/...`；当前没有足够证据批准这些文件的修复。

## 6. 针对性测试与可操作验收

针对性测试至少覆盖：

- 成功 create：项目出现在当前 UI 项目表，唯一 backend id/name 正确，随后进入 source；
- rejected/HTTP error：对话框或结果区域保留可见错误，创建状态结束为失败/未知，不显示假项目、不导航；
- malformed response：被识别为契约错误并可观测，不被静默吞掉；
- 创建成功后刷新/重开：同名项目由真实 listProjects 恢复，且不依赖内存注入；
- 重复点击：请求未结束前只能有一次 create 请求。

可操作验收：在固定 owned profile 中从正式 UI 完成一次唯一名称创建；保存后在项目中心看到该项目，项目详情/source 页面可打开；关闭并重新启动后，连接工作区并刷新项目列表仍看到同一 backend project id/name；保留 create outcome、list readback、renderer 状态、API request_id/status 和必要的 SQLite 行证据。此项通过后再继续保存来源、重开与更高层 C3 验收。

## 7. 当前结论

本次已完成精确的只读诊断方案；没有对 P、runner、配置、数据库或依赖做任何修改/执行。可立即交给总控的结论是：先修复创建结果的产品可观测性并按一次真实交互收集证据，再根据证据选择 API/IPC/UI 修复对象；当前不能声称已定位到持久化根因。
