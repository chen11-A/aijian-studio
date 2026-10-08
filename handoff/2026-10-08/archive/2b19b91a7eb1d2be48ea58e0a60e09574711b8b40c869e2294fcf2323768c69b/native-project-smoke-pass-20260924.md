# PROJECT01 原生 UI smoke 复验（QA02，2026-09-24）

结果：**PASS，exit 0**。本轮只证明新构建上的本地项目空态、AI 服务表单格式校验、隔离 profile 中的 Sub2API 连接保存与正常关闭后重开读回。没有真实 provider 请求、模型探测、生成或上传；假 `.invalid` 地址与假 key 不代表远端能力、权益或额度。此前四轮 RED 原始记录见 `native-project-smoke-review-20260924.md`，均保持原样。

- 产品根：`C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`；HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`。
- QA03 新构建清单：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa03-global-services-20260924\run-tsfix-01\after-desktop-build.json`，SHA256 `981F660FD7BF4EC58731EE6883FE729DC10DF6AC382DA6AF13D52355E669B35D`。
- 本轮 runId：`qa02-project-native-20260924T082806Z-qa02a`。批准计划 SHA256 `D85C91DD88FBF5CC88FE18B6820865FECD3E1E9E1D2FFF8712C7AE51C69C29B5`；经理 approval SHA256 `97D1723EF04A359EBE3DBAA2F5EF12405816043D7899CCE568195D18F234B06C`。绑定 69 源文件、76 dist 文件及 1 个 clean 运行时源文件，共 146 个文件；前后 SHA、字节、HEAD 和 66 行 Git status 一致。
- 证据目录：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\evidence\qa02-project-native-20260924T082806Z-qa02a`。`result.json` SHA256 `135F47B27C8CF6AAB22AF3F0D44E782A4282D93EAAFD28552FFBDB7E02B3023D`；`events.jsonl` SHA256 `0C0CEA586218DCB3535A432C98139C53C2A0E775D3878C2FFE6CC0FA93A37D86`。
- 外层原始执行目录：同一工作目录下 `qa02-project-native-20260924T082806Z-qa02a-execution`；`stdout.txt` SHA256 `0C8F36D97ABA11D8EC34A6FF01A723AD1B0BAC8297D091E15E12D40C1295C927`，`stderr.txt` 为空，`exit.txt` 为 `0`。

## 原生行为

| 阶段 | 观察结果 |
|---|---|
| 首次窗口 | 唯一 BrowserWindow/webContents；Electron main PID 3012 与 Win32 HWND owner PID 3012 一致，独立 sidecar Python PID 20088。窗口、真实 c19 Electron 路径及 launcher 祖先链在 result/events 中留证。 |
| 项目与导航 | 本地项目为空；Page locator 导航到 AI 服务。导航后 DOM 标题含“AI 服务”，表单存在；先保存项目空态、导航后截图/DOM/console，再判标题与表单。 |
| 输入验证 | `https://qa-native-project.invalid/v1` 返回本地 origin 格式错误，连接数保持零。 |
| 本地保存 | `https://qa-native-project.invalid`、Sub2API、TEXT 模型 `qa-text-only` 保存后，卡片显示连接名、origin、模型 ID 和“密钥已配置”。 |
| 首次关闭 | `electronApp.close()` 正常，c19 相关进程零，两个 LOCK 可独占只读打开。 |
| 同 profile 重开 | 新 Electron main PID 15576 与 Win32 HWND owner PID 15576 一致；AI 服务导航、表单与保存连接均读回。连接名、origin、模型 ID、“密钥已配置”与首次保存一致。 |
| 最终关闭 | 正常；c19 相关进程零，两个 LOCK 可独占只读打开。 |

两次运行均没有 renderer 或 Electron main console error、Page 未捕获错误，也没有非 loopback renderer 请求被阻断。`services-saved.png` 与 `services-reopened.png` 已目检：两张截图均显示相同的连接卡片；`result.json` 中还有各次导航后截图、DOM 标题和窗口快照。隔离 SQLite 只读检查为 schema v22、恰好 1 条 `SUB2API` TEXT 连接、项目 0、外键错误 0、完整性 `ok`，数据库文件不含假 key；SQLite SHA256 `C0A646C5EA4803B85BD64A412A5309FAF9385153FF63A41513AFC6E2977BFF87`。

本轮 QA 已向 MGR02 提交；c19 是否释放给 AC05 由经理决定。
