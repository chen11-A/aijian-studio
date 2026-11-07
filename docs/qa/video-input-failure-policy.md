# 同实际视频输入失败保护（首片段）

本片段只保护每个 API 工程内、Grok StoryFilm 的实际 `video_submit`，包含普通生成和现有局部重做调用。它不是金额预算，也不覆盖图片、TTS、编辑/延长接口或整条未变创作稿的失败次数。原费用授权与会员能力门仍独立执行。

## 实际边界

- 未配置没有默认数字。读取返回 `UNCONFIGURED`；新增真实生成在完整缓存复用判断后、任何新增图片/TTS 之前停止。显式整数上限为 0–1000，0 阻止新增生成；1000 是接口技术边界，不是推荐付费额度。stub、缓存复用和 GET 轮询不计提交。
- 配置通过主帧固定 IPC、已有 `backendProjectId`（`prj_…`）与受保护 sidecar API 保存，使用 revision CAS。没有自动创建工程或改变 FilmProject。PUT 的状态、下一 revision、明确 limit 全须精确匹配；网络/非法或不匹配回读返回 `WRITE_UNCONFIRMED`，只能显式 GET 核对，不自动 PUT 重试。
- main 从同一次新鲜登录会话取得实际 bearer 和可信 subject；账户桶由稳定 endpoint origin 与 subject 派生，不随 token 刷新、scope 排序、连接 revision 或 sidecar 重启变化。未知 subject 不授予预算身份。main 对实际原始 HTTP body bytes、工程、幂等键、本次 bearer 摘要和有效期签名；API 使用原私有 sidecar 会话密钥核验。该通路不接受 renderer 提供账户标识，不代替原授权，也不声称抵御持有主进程/sidecar 密钥的本机代码。
- 桶绑定完整实际视频 POST 参数及首帧、按角色/顺序保留的参考图 bytes SHA。JSON 键顺序不分新桶；未被无音频视频请求消费的上游 voice 字段不另分桶。图片生成结果改变 bytes 会形成不同视频输入，因此本片不宣称限制父级创作稿整链重试。
- 已取得图片 bytes 的 URL 响应以这些 bytes 的 data URI 提交，不在核验后又使用可变 CDN URL。已知 URL-only still/reference 在新增生成前拒绝。图片真实下载 403 时，已发生的那一次图片请求保留，随后不再发 TTS/视频；返回 `VIDEO_FAILURE_INPUT_UNVERIFIABLE`。这是原 URL-only TLS StoryFilm 正向行为的明确收紧；底层未获预算授权含义的 URL-only 协议能力仍保留。
- 在真实 POST transport 入口前 SQLite 原子持久保留占位。PENDING、UNKNOWN、FAILED 都占失败上限；崩溃、换任务 key、并发和配置升降 revision 不删除已有占位。仅任务编号不代表成功。真实 poll done、完整下载且固定 ffprobe 确认可读视频帧，才释放该视频的失败占位；后续本地对白适配/字幕/合成失败不冒充 provider 失败。两镜相同实际视频输入、上限 1 时，第一镜已证成功不会阻塞第二镜。
- 未知提交不自动 POST。当前运行中的 GET 轮询可取得终态；本片没有实现重启后未知提交的 GET 恢复/核销 UI，没有伪称占位可自动解除。配置提高上限也不重发任务。

## 合同

稳定合同 checkpoint：`1075208ad8021bb57895f509fa4596901015f46a`，仅三文件 type/export/StudioBridge，不是完整消费者交付。主桥 `getGenerationFailurePolicy(projectId)` / `configureGenerationFailurePolicy(projectId, {expected_revision, failure_limit})` 返回 `POLICY` 或固定 `FAILED` 四码；实际配置 UI 在独立前端片段接入后联合验收。

五个真实生成提示独立登记于文案表和 notice 完整性合同；没有修改历史 118/106/14 等分组或测试门。

## 验证证据

- `/tmp/generation-budget-final-python-targets.log`：相关十文件 107 通过，250.45 秒。该快照之后仅收口实际视频 body 语义指纹、API 裸账户拒绝和更早的 URL-only 阻断；不把这个数字冒称覆盖后续增量。
- `/tmp/generation-budget-final-core-python.log`：最终同源四文件 32 通过（完整预算生产/存储/API/签名负向矩阵；与之前范围重叠，不相加）。
- `/tmp/generation-budget-final-delta-python.log`：最终 body、真实两镜上限 1、本地后期失败、unknown/new key/restart/配置、签名/API 等 18 通过，29.90 秒（与上述子集重叠，不相加）。
- `/tmp/generation-budget-final-url-boundaries.log`：最终真实 TLS 正向、403/0 后续付费、已知 remote still/reference 的 0 新调用，共 4 通过、10 未选。
- `/tmp/generation-budget-final-identity-negative.log`：签名有效期/shape/账户及不可证图片 bytes 十二个安全反例通过。
- `/tmp/generation-budget-final-revision-proof.log`：最终 unknown 生产路径再核 token/连接 revision/new key 与配置升降均不重置（单项）。
- `/tmp/generation-budget-main-final2.log`：六文件 54 通过，含真实 fresh-session token 刷新、主帧 IPC、沙箱 preload、原 client 与 PUT 错回执。
- `/tmp/generation-budget-notice-stage.log`：两文件 111 通过，五码闭合及历史分组不变。
- `/tmp/generation-budget-formal-ts2.log`、`/tmp/generation-budget-final-mypy.log`：正式 TypeScript 和 Python 317 文件类型通过。
- `/tmp/generation-budget-final-build.log`：工作区构建通过；`/tmp/generation-budget-final-cjs.log` 与 `/tmp/generation-budget-final-isolated-main.log`：真实合同 runtime builder、隔离编译 main helpers 和 CJS 合同加载通过，无源码 loader 回退。

首次失败日志保留：`generation-budget-api-stage.log`（闭包 Depends 被误读为 query）、`generation-budget-legacy-consumer-stage.log`（受控旧夹具缺新前置及 URL-only 行为）、`generation-budget-formal-ts.log`（新测试类型）、`generation-budget-eslint-stage.log`（控制字符正则）。均按真实问题修复，未降低生产门或测试数量。

所有生成均为注入的本地协议替身与合成媒体；TLS 仅本机服务器。未调用真实会员或付费提供方。完整 Python/覆盖率、原全 TypeScript、真实 Windows 和前端配置 UI 联合由总控在最终冻结源上另验。

补充跨语言实际字节实证：`node /tmp/aivora-generation-budget-cross-language.cjs <冻结树>` 使用实际编译 main helper 签含中文和空字幕的 body，由实际 Python 验证器核正向及 body/key/bearer/幂等/过期/过远未来六个反例；`/tmp/generation-budget-final-cross-language.log` 通过，不输出凭据或签名。
