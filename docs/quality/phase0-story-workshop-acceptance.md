# Phase 0 故事工坊验收记录

日期：2026-08-04

范围：SourceManifest / StoryBible 只读纵切、受限 Electron IPC、逐事实来源证据和专业三栏工作台。

## 证据等级

- 真实浏览器：Google Chrome 148.0.7778.168，Windows，本地 Vite 页面，通过 Chrome DevTools Protocol 验收。
- 数据：浏览器网络边界注入与公开 OpenAPI 同形的 UTF-8 冻结夹具；没有写入工作区数据库。持久化与服务端权威 `quote_hash` 另由 Python API/Repository 测试覆盖。
- 本记录不等同于真实 Electron 验收；两次冷启动恢复、随机 sidecar 端口、Renderer 无 Node/令牌仍是本阶段后续门禁。

## 浏览器结果

| 视口     | document 宽/客户宽/高度 | body 宽/客户宽 | 横向溢出 | 视觉结果                                     |
| -------- | ----------------------- | -------------- | -------- | -------------------------------------------- |
| 1440×900 | 1425 / 1425 / 1525      | 1425 / 1425    | 0 px     | 三栏同时可见，版本、Gate、证据和审阅层级清晰 |
| 980×680  | 965 / 965 / 2457        | 965 / 965      | 0 px     | 顶部导航与横向项目轨，故事标题不压缩         |
| 390×844  | 390 / 390 / 3754        | 390 / 390      | 0 px     | 单栏分段，版本和 Gate 状态保持可见           |

首次 980×680 检查发现故事标题在侧栏与项目轨之间被压成逐字换行；将紧凑顶部导航断点调整为 1100 px 后复验通过。

## 交互、可访问性与真实性

- 控制台 error/warning：0；有意义的网络加载失败：0。
- 语义树包含“创作模块”导航、“故事工坊”“故事圣经”“来源预览”“逐事实证据”“结构化正典”“编剧审阅”等具名节点。
- 40 次连续 Tab 的硬断言可到达首页、项目/故事工坊导航、新建项目、项目卡、故事/G1 版本选择、全部来源文档、打开原文上下文、实体/事实搜索、证据按钮和实际 `.conflict-facts` 关联事实按钮；当前模块使用 `aria-current=page`。
- 事实证据显示精确 UTF-8 左闭右开字节范围、服务端引文哈希、证据角色、claim 和从对应 SourceBlock 切出的原文；无证据事实的按钮禁用，不能伪装为已核对。
- 冻结夹具包含两份来源：G1 区列出每份文件、完整 `source_document_id` 和章节数；首个事实的引文来自第二份《港口补遗》的第 9 个 SourceBlock。上下文动作会加载以目标块为中心的窗口，把准确块滚入视口、聚焦并高亮，而不是错误展示默认前 7 块。这实际证明每个 span 按自己的来源和精确块读取，不会退化为“最新导入文档”或“文档开头”。读取失败会显示明确告警。
- 页面只读取当前选中的来源与当前事实 spans，最多 4 个并发请求并在项目内缓存；故事首页只取 latest/review/accepted 摘要，切换版本才按精确 ID 懒加载完整不可变内容，不会在打开工作台时传输三份故事正文或遍历所有事实和来源全文。完整响应由 API 和 Electron main 双重限制为 16 MiB；API 在同一 SQLite 读事务中先按正文 UTF-8 字节、span 数量和 claim 字节下界拒绝明显超限历史版本，再做最终 envelope 精确校验；main 在解析前流式计数，Renderer 的完整版本 LRU 缓存最多 3 项且命中会刷新淘汰顺序。
- 绑定 fact、entity、source_document 的开放问题提供可操作跳转；选择后对应事实、实体卡或来源预览进入活动状态，编剧不需要手工复制内部 ID 查找上下文。
- 冲突中的合法事实即使尚无 SourceSpan 也保持可导航，进入后明确显示“没有绑定可核对的精确引文”；390px 下“打开上下文”和冲突事实按钮均硬断言为至少 44px 高、12px 字号。
- `prefers-reduced-motion: reduce` 生效；最大动画和过渡时长均为 0.01 ms。
- latest、review、accepted 可查看实际不可变版本，优先显示 review；故事版本绑定旧 G1 时显示 stale 警告；开放问题和未解冲突不会被前端计数推断成“可批准”。
- G2 提交按钮保持禁用，Renderer 没有审批令牌或可信 actor 能力。

## 可复现证据

- [1440×900 截图](evidence/story-workshop-1440x900.png)
- [精确原文块定位截图](evidence/story-workshop-context-1440x900.png)
- [980×680 截图](evidence/story-workshop-980x680.png)
- [390×844 截图](evidence/story-workshop-390x844.png)
- [控制台、网络、视口、Tab 顺序、AX Tree 与 reduced-motion 原始结果](evidence/story-workshop-results.json)
- [公开契约同形的 UTF-8 冻结夹具](evidence/story-workshop-fixture.json)
- [Chrome CDP 验收脚本](../../scripts/accept_story_workshop.py)

Windows 复验命令（在仓库根目录分别启动页面、Chrome 和验收脚本）：

```powershell
pnpm --filter @aijian/studio-web dev --host 127.0.0.1 --port 5173
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) { throw "未找到 Google Chrome" }
Start-Process -FilePath $chrome -WindowStyle Hidden -ArgumentList @(
  "--remote-debugging-port=9333",
  "--user-data-dir=$PWD\.cache\chrome-story-acceptance",
  "about:blank"
)
.\.venv\Scripts\python.exe scripts\accept_story_workshop.py --base-url http://127.0.0.1:5173 --cdp-port 9333
```

脚本只拦截当前验收页的 `/api/v1` 请求，未知路由返回 404，并硬断言所有捕获请求均为只读 GET 且响应 200。它会先用 Pydantic 公开响应模型验证夹具，再校验 manifest/source block 坐标、故事 scope、span 不越出绑定块、UTF-8 字节切片与语义引文 hash；随后断言三视口溢出、标题、两份来源的文件名/完整 ID、第 9 块跨文档引文的精确上下文定位、390px 关键审阅触控尺寸、活动版本、未预取其他故事版本、G2 禁用状态、控制台/网络、reduced-motion、AX 名称和键盘到达冲突事实。失败时以非零退出，并在 CDP `success:false` 时通过回退端点关闭自己创建的 target。开发模式允许同一 effect 因 React StrictMode 重放一次，但不允许加载未选择的版本。运行前应确保 5173 和 9333 未被其他进程占用。

## 影片团队结论

当前编剧可以在一个工作台完成“核对来源版本 → 选择结构化事实 → 查看精确引文 → 检查开放问题/冲突”的只读审阅准备流程。尚不能完成一次正式 G2 送审、finding 处理、签署和 Gate 决策，因此影片团队的完整 G2 审阅验收为“待后续纵切”，不能因本次技术验收而标记通过。

## 自动化门禁

同一提交前工作树已通过：

- Prettier、ESLint、TypeScript、Ruff 和 mypy 全部通过；Web 与 Electron 构建通过。
- Python：153 项通过，总覆盖率 94.10%。
- Electron/desktop：41 项通过；statement 92.10%、branch 92.49%、function 98.92%、line 95.05%。
- Studio Web：36 项通过；statement 90.74%、branch 86.96%、function 91.62%、line 95.02%。
- OpenAPI 与生成 TypeScript 连续生成哈希一致；相对 Markdown 链接、UTF-8、`git diff --check` 和凭据特征扫描通过。
