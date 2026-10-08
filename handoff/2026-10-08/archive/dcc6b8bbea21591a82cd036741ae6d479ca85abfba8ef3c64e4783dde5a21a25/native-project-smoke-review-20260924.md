# PROJECT01 原生 smoke 停止记录（QA02，2026-09-24）

结论：**未通过原生 UI 验收**。c19 保持不释放给 AC05。四次尝试均使用新的 runId、隔离 profile、经理绑定的计划与审批；前三次分别在文件清单、PID 定义、Electron 符号链接路径门槛停止。第四次通过窗口所有权门槛，随后 AI 服务页面标题等待超时，按停止条件未继续。四次原始记录、计划和审批均保留，未在旧 profile 重跑。

产品根：`C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`。第四次运行前后 HEAD 均为 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，Git status 均为 66 行；冻结计划为 QA03 的 69 源文件、76 dist 文件，加 1 个运行时必需的 clean 源文件，共 146 个文件。

| runId 后缀 | 停止点 | 原始执行目录 | result.json SHA256 |
|---|---|---|---|
| `075705Z-qa02a` | 启动前：计划缺 `apps/desktop/src/e2e-user-data.ts` | `qa02-project-native-20260924T075705Z-qa02a-execution` | 无 result；profile 未创建 |
| `080001Z-qa02a` | 首窗：Playwright launcher PID 与 Electron main PID 被误要求相同 | `qa02-project-native-20260924T080001Z-qa02a-execution` | `27A6882877C93E6DC17E6072C0A40A1113E913701419B2EFA0D4A537E858E072` |
| `080622Z-qa02a` | 首窗：Electron 的逻辑路径与符号链接解析路径被误判不同 | `qa02-project-native-20260924T080622Z-qa02a-execution` | `7A52593D7AAE265E85A70F98153DB41CCFCD17AADAFF27DD784331F7EF7BC73B` |
| `080857Z-qa02a` | 点击 AI 服务后，精确 `AI 服务` 标题等待 10 秒超时 | `qa02-project-native-20260924T080857Z-qa02a-execution` | `D0B5E65774F9039CDD2274271CC2BB1F950B14DBDA9EB0B924187E235D8D30CE` |

以上目录及各次 `evidence/<runId>` 均在本文件所在的 `native-source-qa-20260924` 目录下。第四次 `events.jsonl` SHA256 为 `4E95C45C31045894C818DC9648264276AC16149900B75C9137838341F08F575B`；启动就绪截图 `launch1-ready.png` SHA256 为 `08C039E333FDAE69E1EABC7907FF105952BD012543C900277E8450B1A77C5277`。此截图拍于导航前，没有导航后的截图。

第四次实测：唯一 BrowserWindow、webContents ID 1；main PID 7028 等于 HWND `2165478` 的 Win32 owner PID，祖先进程链为 Electron 7028 → Playwright shell launcher 8992；sidecar Python PID 20460。窗口 Page locator 对“打开项目中心”和“AI 服务”的点击均返回。没有填入 API Key，没有保存连接、模型探测、生成、上传或第二次 launch。正常关闭返回 true；关闭后 c19 相关进程为零，两个 LOCK 可独占读取。隔离 SQLite 只读检查：schema v22、连接 0、项目 0、完整性 `ok`。

静态定位：`apps/studio-web/src/aivora/DemoApp.tsx` 第 41–46 行把没有 activeProject 计入 `missingPageData`；第 378–392 行对 services 页也优先渲染 `ProjectContentEmpty`。空项目状态下，源码会给出 `apps/studio-web/src/aivora/data.ts` 第 116 行的“AI 服务与模型”占位标题，而非 `apps/studio-web/src/aivora/UtilityPages.tsx` 第 66 行的“AI 服务”配置页。这个分支解释了第四次标题等待超时，但第四次未在点击后截图或抓取 DOM，因此将其记为**源码支持的原因推断**，不是独立视觉读回。

后续须由产品 owner 决定是否修复空项目时的 AI 服务管理入口，并在同源构建、独立审批后重新做原生 UI 验收。当前记录不能证明 provider 连接的保存或重开读回。
