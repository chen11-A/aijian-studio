# 创作流程失败保护：独立正常浏览器门

基线 `d5d54307d17c62fdb88977b1986f2f7863541a7b`。复用原 trial QA 工作树，新分支 `codex/aivora-story-policy-browser`；原 `f327820227f60cbbdefe7ac09263eaf0e43074c3` 及其分支保持冻结。本片仅 QA/CI，不修改产品、配置合同或生产 API。

## 固定范围

新增 `story-policy` profile，四态 × 1280×800/1920×1080 × 16:9/9:16 = 16 执行组合。原 452 组合及 workflow 全部字节前缀保留；468 是定义数量，新增正常 Chrome 尚待 CI，不是已通过数量。

| 状态                  | 真实 Pro 行为与断言                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| story-policy-values   | 作品→作品设置→独立创作流程入口；默认零请求、UNCONFIGURED 输入空。空/负数/小数/指数/1001 不写；显式 0、1000 分别精确 revision +1。旧视频 scope 仍是77，重新打开父链不继承该值。                                                           |
| story-policy-conflict | 默认首次 PUT 真返回 POLICY_CHANGED，自动 GET 得到 revision1；保留用户7，不自动 PUT；用户第二次提交才一次使用新 revision。                                                                                                                |
| story-policy-unknown  | 默认首次 PUT 已受控落服务状态却回 WRITE_UNCONFIRMED；第一次手动 GET 仍未确认，保存按钮不存在；再一次手动 GET 才确认，始终单次 PUT。                                                                                                      |
| story-policy-session  | 默认模式自身准入 held PUT；忙时禁重复提交但关闭可达；真实作品菜单进入另一集，等待该集正常初始化保存完成后取完整 raw/write 基线，再释放旧 ACK。新集仍未配置。另持有 GET 后触发真实账号变更事件，退休旧窗口/回调，再打开新会话仍无旧成功。 |

保持真实六镜、每镜三版及原素材。配置不申请媒体/生成/工程创建，所有付费/未知派发仍 forbidden；原始工程全 raw 与另一集正确初始化基线均保留。fixture 记录实际 writeFilmProject 完成回执，配置/release/账号核对期间不能产生额外工程写入。展示、滚动到保存/刷新/关闭及原几何阈值不变；模态仅核当前可操作范围。

## 已执行的受控检查

- 同一默认 ABI 的实际 Pro 宿主：四态核心 + 缺 API ID/缺桥，共 **6 项通过**。非手工把 pending mode 改成 hold；默认 session 已准入真实受控 Promise。缺能力/缺真实 prj ID 均零 policy/provider/create 请求。
- Node 契约：旧135 + 新9 = **144 项**。新项覆盖四个默认模式、严格 scope/revision/值边界、未知多读、held admission、付费与创建禁门、CLI unsafe/setup 退出、固定16计数和二次白名单（有限数值/行号、max8、PRIVATE/NaN/Infinity 不泄露）。
- `/tmp/story-policy-browser-host-final2.log` 为加写回计数后的 6 项阶段结果；最终联合/静态见 `/tmp/story-policy-browser-host-final3.log`、`/tmp/story-policy-browser-all-contracts-final2.log`、`/tmp/story-policy-browser-eslint-final.log` 与 `/tmp/story-policy-browser-format-final.log`。
- 初次短 host 未复用布局 seed 的场次排序而找不到当前场镜，已按原六镜三版 seed 事实修正；session 短 host 的异步释放须在 React act 中完成再开新会话，受控前/后日志保留，不修改生产 guard。清理只针对本树明确自有 PID，从未全局清理或终止根验证进程。

## CI 与证据界限

独立 `pro-story-policy` Ubuntu job，Node24.15，15分钟。先持续执行9项 Node 契约，再运行正常沙箱 Chrome；保留外 HTTP/API 禁止及原安全 CLI。artifact 仅精确三条：`.aijian-dev/pro-story-policy-audit/report.json`、`1280x800-*/*.png`、`1920x1080-*/*.png`。源码 hash 覆盖实际配置合同、native、preload、Pro、view/hook及本片脚本；公共注释只固定 state/控件/有限几何与行号，无原始正文/身份/路径/错误栈。

这是实际 UI 加 synthetic policy ABI 的交互/隔离证据，不能替代 API 持久化、原子计数/占位、真实账户/费用或媒体测试。当前已知自动前置画面 `prepareSceneMedia`/`ensureShotFrame`/`requestStill` 仍有父上下文贯穿待办；本配置 QA 不声称整条自动前置图已受父保护，也不以读取 GET 代替原子准入。原视频设置、试片人工接受及费用/数量确认保持独立；此片不提供 usage/remaining、不自动核销未知或继续生成。
