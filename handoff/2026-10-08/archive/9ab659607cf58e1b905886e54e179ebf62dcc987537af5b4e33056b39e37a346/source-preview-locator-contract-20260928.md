# QA02 来源预览原生定位静态契约（2026-09-28）

当前只读对照 c19 211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2 的源文件；这是下一轮 runner 的定位依据，不是 UI 运行通过证明。首轮/次轮失败原始记录和各自 profile 不改动。

| 顺序 | runner 定位与前置状态 | c19 源码依据 |
| --- | --- | --- |
| 连接与项目中心 | 首屏无连接按钮时点击“打开项目中心”；项目中心存在 .v2-project-search，其内“新建项目” | HomePages.tsx 290、455–470；model.tsx 1357 及 812–878 自动连接逻辑 |
| 新建项目对话框 | dialog 标题“新建项目”；字段“作品名称”；提交按钮文本为“保存演示修改” | HomePages.tsx 38–56；Common.tsx 214–269、310–325；model.tsx 1425–1442。旧 runner 的“确认”无对应按钮 |
| 创建成功后来源页 | createRealProject 明确成功后转 source；按钮“粘贴故事”、textarea aria-label“外部原文正文”、按钮“作为外部原文导入” | HomePages.tsx 47–61；StoryPages.tsx 813–858 |
| 本地导入读回 | 成功状态包含“来源已保存并读回确认”；导入成功把 normalizedText 写入来源值，预览 excerpt 使用该值 | StoryPages.tsx 861–871、1015–1017；model.tsx 1102–1128 |
| 本地审核 | 来源页 FlowFooter“开始理解故事”打开标题“来源审核 · v...”的 dialog；其提交文本“提交真实来源审核”；成功后转故事页 | StoryPages.tsx 177–202、1260–1280；Common.tsx 214–269、310–325 |
| 返回审核中的来源 | 审核中选择器目标 source-review；故事页按钮显示“返回来源审核”并回到来源页 | adapters/productionSourceStage.ts 65–89；StoryPages.tsx 147–151、784–797 |
| 预览底部两按钮 | 来源处于 review 时显示“确认来源审核基线”；始终显示只读“刷新来源状态”；二者在预览卡 actions 内 | StoryPages.tsx 1014–1033；v2-story.css 320–365。runner 只测确认按钮几何/命中/Tab，不点击 |
| 重开项目与故事导航 | 项目行 .v2-project-row 按钮“打开项目”；侧栏“故事 / 剧本”；异步选项目会恢复正文与来源审核状态 | HomePages.tsx 498–517、58–68；DemoApp.tsx 297–321；data.ts 167；model.tsx 929–977 |

运行时停止条件：每个 locator 必须唯一、窗口 owner/launcher/sidecar 必须保持，合成来源保存或审核若为 UNKNOWN 不重发；最终仍要由真实 Electron 截图与 DOM 几何证明 1424×881、低窗和窄窗布局，不能用此表替代。
