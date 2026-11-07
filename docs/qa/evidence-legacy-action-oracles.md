# 交付专项：四束旧操作的真实消费者同步

正常 Chrome 第二轮 source 472 / run 42366286704 / job 128384952047 的八条公开注释均 reached=1：1280 两画幅的四个 legacy state。共同 boot 已跨过；八条公开上限不能用于推断其他 24 组合或证据四态已经成功。此批不改产品、状态数、几何阈值、拖拽/多选/undo、实际秒数、全屏或付费禁门。

实际 Pro 受控 before：`/tmp/evidence-actions-controlled-before.log` 四例均失败。修后新四例与原 boot 共 5/5（`/tmp/evidence-actions-host-after-stage.log`）。

- 生成确认第一列的真实 `scopeOf` 是“第 N 场第 M 个镜头”，不是“镜头 M”。浏览器改为完整精确场/镜名两行，仍只确认原选中的 1/3 两镜，不提交，原拖镜/批删/撤销/全部媒体保护不动。
- 合成私有协议没有真实 decoder metadata，readyState 保持 0。真实 PreviewVideo 每次 seek 会重新等 loadedmetadata；原 case 在按键前发过一次事件，之后一直等 currentTime=1，受控 before 确为 0。复用已有 B08 做法：按键/指针请求后让真实 effect 注册，再交付 DOM loadedmetadata，读取真实 currentTime/标尺，未覆盖 currentTime/readyState getter、未改 React 状态。
- 人物 `.t` 的真实子树是名字加“定妆照 0/4”，不等于名字的全局 exact text。改为搜索后唯一的实际人物 button，精确核其名字文本节点后点击，仍核人物名字输入与助手上下文；不绕过检索或点击私有 handler。
- 进入剪辑真实调用了六次 `readFilmAudioWaveform`，旧 creation bridge 将它错误归为 forbidden，受控 before 记录恰六项。本片仅为此合法本机能力提供有界拒绝：严格三字段、canonical 唯一 clip/shot/take、实际 sourceKey；无选版旧 clip 为 SOURCE_CHANGED，其余 TOOLS_UNAVAILABLE，不制造峰值、不解码/混音。paid/旧 export 等禁门原样，所有请求数量和 key 另用实际生产 audioSourceKey 核对，原 clips/takes 不变。

全旧新 Node 契约 111/111（旧 110 加一条本机波形 scope/key/拒绝回归，`/tmp/evidence-actions-all-contracts-final.log`）。实际 Pro 四例覆盖真实确认表、聚焦标尺 effect、检索 button 和本机准入；不把 jsdom 当正常 Chrome、实际拖拽像素或实际解码。新增实际源键 helper 两条固定源码指纹。

## 覆盖统计边界

根固定 d5 原 458 文件 5502 项实际全通过，但 statement 89.47 低于原 90 门；新 actual-Pro boot 首次导入五个 e2e QA fixture/helper，被 V8 加入产品分母。根独立非 e2e 统计 statement 90.33；原失败保留，不能把它记成全门通过。

配置使用实际 `vitest/config` 的 `coverageConfigDefaults.exclude` 完整展开，仅追加 `e2e/**`。没有改测试发现 exclude、任何 src 范围或任何阈值，boot 和新增 actual-Pro 用例照常运行。实际 loadConfig 证明 `/tmp/evidence-actions-coverage-scope.json`：默认 exclude 完整保留，唯一 extra 是 e2e，1096 个 src 条目新模式匹配 0，statement/line/function=90、branch=80。它是测试工具与产品代码统计的边界，不是降低 90 门；根仍须运行新冻结源的原完整覆盖门。
