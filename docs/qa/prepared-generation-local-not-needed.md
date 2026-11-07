# 全所选本地视频：无需新增媒体回执

本片只接 `NOT_NEEDED / LOCAL_SELECTED_MEDIA`。pipeline 必须给出当前 canonical 全部镜头的完整有序 scope；main 使用实际 `generationSelectedMedia` / `resolveAudioMix` 核所选 native/visual 文件归属、SHA 与视频流时钟，再 fresh raw、source verify、最后 raw/owner 核对。缺失、错误、未知媒体不解释为无需生成；仍有 pending 视频的 pipeline 暂不启用。此回执不创建 execution、stage、slot，不读会员账户、不调用 API/provider、不写工程。

renderer 精确核回执 scope/hash/所选版本，不能由它的路径或 ID 自造回执；没有可用于 image/video 的 locator。实际 pipeline 可跳过未消费的肖像/首帧生成，不填造图片。原首次媒体数量确认、人工审片记录、独立继续和 assembly 保留。若之后本地视频变为不可用，不能借旧回执发视频。回执不代表 provider 缓存命中、人工观看或费用授权。

## 实测分层

- `/tmp/generation-notneeded-web-final.log`：4文件66项通过，含原三条实际 Pro pipeline、controller、workspace、session。新增 Pro 用真实入口走首次媒体确认→审片展开/填写→明确继续→一次新 assembly，0 text/image/video，完整保留原 shots/takes/poster/locations；桥回执是 controlled ABI，不冒充本机媒体/解码证明。观察实际 workspace Promise 只等待真实 recovery/save-lease 完成，不调用私有状态回调。
- `/tmp/generation-notneeded-native-final.log`：初次2文件35项通过（晚变更两例加入前）。
- `/tmp/generation-notneeded-local-guards.log`：真实 FFmpeg/原工具锁与 producer 下，本地正向及 probe 期间 owner/canonical 晚变更3项通过、23项未选。0账户、0API、无 factory 工程写；缺文件另有严格 SOURCE 负例。
- `/tmp/generation-notneeded-native-joint-final.log`：最终2文件37项通过 / 14.17秒，包含晚 owner/canonical 两例和原 factory/service。双端正式类型、目标 ESLint、Prettier、diff 全0，见 `/tmp/generation-notneeded-{native-types,web-types,eslint,prettier}.log`。首 web 类型发现测试未收窄 upgradeFilm 可空回执，已改为显式无效fixture拒绝，原失败保留于会话；各阶段不累加为完整门。

## 保留的失败与边界

初 Pro 失败日志 `generation-local-consumer-first`、`generation-local-pro-{observed,second,closed-state,third}` 保留。既有 pipeline seed 原缺 backendProjectId，实际 billing 准入补 ID 后正确触发旧指纹保护；修为先建立 billing ID 再建立既有持久指纹。随后第三次已到真实 review，因测试漏点“要处理的”展开而无 textbox，按原三例真实入口补齐后 fourth 单例通过。没有改产品超时或保护。

真实 legacy 若旧 pipeline 已有指纹但无 backendProjectId，原 execute 的 ensureBillingProject 可能补 ID，controller 全业务指纹会拒旧进度（PIPELINE_INPUT_CHANGED）；这是既有迁移边界，未在此叶放宽或重签。

待做：pending pipeline/portrait、fresh、CACHE/连续帧真实能力、旧自动来源跨 execution 的原意图重建。当前原门/normal Chrome、provider 成功、完整人工视听未由本片验证；不挪用旧源结果。
