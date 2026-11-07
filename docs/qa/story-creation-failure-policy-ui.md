# 创作流程失败保护配置 UI

基线：`294f4100739e327a001883101c00dfc80f222765`，实际生产合同与主进程/API 来自 `fc710e884884b4883f9fecfc11add6c1462f23e5`。本片只接前端消费者，不修改 API、主进程、原视频提交保护或生成派发路径。

实际入口为作品菜单 → 作品设置 → 设置创作流程失败上限。首次挂载不读取或写入配置，用户打开后使用当前作品真实 backendProjectId 读取。未配置输入为空，不继承独立视频上限；仅显式整数 0–1000 可保存，0 明确阻止该创作流程新增提交。此项覆盖 StoryFilm Grok 创作流程，不包含独立定妆照/单独配音，不提供费用、用量、剩余次数或默认建议值。

保存使用原 revision CAS。冲突只重新读取并保留用户稿，由用户再次提交；未知写回、异常或错误 ACK 进入只读核对状态，只允许显式 GET，不自动重复 PUT。正确回执必须匹配父链 scope、CONFIGURED、revision + 1 和本次限值。关闭、作品/API 身份变化及账号变化退休旧回调；关闭不冒充取消原服务请求。整个配置过程不修改 FilmProject，不持保存 owner，不生成媒体。

## 本地验证

- 新实际 Pro 宿主 19 项；与原视频配置、原配置展示、退出保存及架构规则联合 5 文件 **42/42** 通过：`/tmp/story-creation-policy-joint-stage.log`。
- 覆盖真实菜单入口、默认 0 请求、两种 scope 隔离、显式 0/1000、非法输入、CAS 冲突保稿、未知状态反复核对、错误 scope/ACK/revision、传输失败不泄露异常、同步双击 1 次 PUT、关闭/账号/本机工程/后端工程身份迟到及旧回调隔离。原工程、媒体与 provider 调用保持不变。
- 正式 web build（包含 `tsc -b`）通过：`/tmp/story-creation-policy-ui-build-stage.log`。
- 目标 ESLint、Prettier 与 diff 检查以最终日志记录为准：`/tmp/story-creation-policy-eslint-final.log`、`/tmp/story-creation-policy-format-final.log`。

这些是实际 Pro 加受控原生 ABI 的 UI 行为验证，不替代主进程/API 的原完整门，也不证明会员账号、真实费用、播放或人工视听。尚未新增本片正常 Chrome 状态；原试片浏览器 16 态在独立冻结提交中，不能用于声称本配置已获浏览器正向。
