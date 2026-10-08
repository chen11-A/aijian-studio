# Phase 0 媒体时间基线契约

状态：Implemented（M01）

依据：[ADR-0003](../architecture/ADR-0003-timeline-timebase.md)

## 目的与边界

在接入 FFmpeg、时间线和导出之前，先冻结不会累积漂移的媒体时间边界。持久化、HTTP
或任务输入中的权威时间值不得使用浮点秒，源媒体探测值也不得覆盖 Sequence 的编辑时间基线。

M01 只交付契约、纯计算和验证规则，不宣称已经完成 FFmpeg 探测、代理生成、播放、时间线编辑
或 MP4 导出。这些运行时能力分别由 M02 及后续条目验收。

## 有理数与整数边界

- 有理数统一表示为 `{num, den}`；两个字段都必须是严格 JSON integer，拒绝浮点数和布尔值。
- `den > 0`，且 `gcd(abs(num), den) == 1`；零只能表示为 `0/1`。
- 所有进入 JSON/TypeScript 的分子、ticks 和帧位置限制在
  `[-(2^53-1), 2^53-1]`。若未来必须表达更大的 FFmpeg/SQLite int64，跨语言时必须改用十进制字符串，
  不允许静默放宽为 JavaScript `number`。
- 媒体 `time_base` 使用正有理数，`num > 0`；通用 `RationalData` 可以表达负数，但不能充当时间基。
- 模型及嵌套条目验证后不可变，防止绕过整体不变量。

## Sequence 帧率与时码

Phase 0 只支持以下固定帧率：

- `24000/1001`
- `24/1`
- `25/1`
- `30000/1001`

时间推进和人类可读时码地址是两个概念。`NON_DROP_FRAME` 对四种帧率均可用；
`DROP_FRAME` 只允许与 `30000/1001` 组合。Drop-frame 只改变时码编号，不改变真实帧时长。
OpenAPI 使用封闭 `oneOf` 组合发布上述四种帧率及五种时间基组合，生成的 TypeScript 也必须保留字面量联合类型。

## 48 kHz 音频帧边界

- Phase 0 接受 44.1 kHz 和 48 kHz 源音频，进入编辑链后统一为 48 kHz。
- 帧 `n` 对应的工作音频样本位置必须从绝对帧索引一次计算，禁止累加“每帧四舍五入后的样本数”。
- 设 Sequence 帧率为 `num/den`，则精确分数为 `n * 48000 * den / num`。
- 舍入规则固定为最近整数、恰好半样本时向上：
  `sample(n) = (n * 48000 * den + floor(num / 2)) // num`。
- 中间乘法必须使用任意精度整数；TypeScript 实现须先转换为 `BigInt`，不得用 `number` 直接相乘。
- 最终样本位置也必须不大于 `2^53-1`；能力响应公开该上限，越界必须显式失败，不能返回失真数字。
- `30000/1001` 的前几个边界固定为 `0, 1602, 3203, 8008`（帧 `0, 1, 2, 5`）。

## VFR conform 与代理回连

VFR 源不得直接成为 Sequence 时间基，必须先 conform 为选定 Sequence 时间基的 CFR 代理。
`ProxyTimeMapV1` 同时绑定源/代理 SHA-256、源视频流索引、Sequence 时间基、时间戳种类和映射规则。

版本 1 采用逐代理帧的不可变条目：

- `proxy_frame_index`：从 0 开始且必须连续，不允许空洞。
- `source_frame_index`：从 0 开始、单调不减；允许显式重复或跳过源帧。
- `source_pts`：正 `time_base` 下的 presentation timestamp；全表使用同一 time base。
- 时间戳种类固定为 `PTS`，不是 DTS。
- 抽样规则固定为 `HOLD_LAST_PRESENTED_FRAME_AT_PROXY_FRAME_START`：以首个源 PTS 为相对时间零点，
  每个代理帧起点选择相对 PTS 不晚于该起点的最后一个源帧；若起点早于首个源 PTS，则保持首帧。
- 重复源帧必须重复相同 PTS；源帧索引增加时 PTS 必须严格增加。

M02 在真实 ffprobe/FFmpeg 管线中生成并持久化完整逐帧表，同时确定最大时长、请求字节限制或分块策略。
在 M02/M03 正式引入资产/任务 API 前，`ProxyTimeMapV1` 仍是 Python 内部版本化契约，不声称已发布进共享 OpenAPI。

## 公共 API

`GET /api/v1/media/capabilities` 返回稳定的 Phase 0 声明性策略：

- 五种受支持 Sequence 时间基组合；
- 44.1/48 kHz 源采样率与 48 kHz 工作采样率；
- 绝对帧索引、最近且半值向上的音频边界算法及最大安全样本位置；
- `CONFORM_TO_CFR_PROXY` 与代理映射 schema version 1。

该端点不代表本机 FFmpeg、编码器或 GPU 当前可用；响应继续遵守统一 `request_id`、sidecar 鉴权和安全响应头。

## M01 验收条件

- `media_contracts.py` 行/分支覆盖均为 100%。
- 测试覆盖安全整数、正时间基、时码组合、长时音频无累积舍入漂移、逐帧映射完整性和不可变性。
- OpenAPI 与生成 TypeScript 保留精确帧率/时间基联合类型，且无生成漂移。
- 媒体契约 smoke 在 CI 中先重新生成，再验证 SHA-256，不能用旧证据蒙混通过。
- M02 的 FFmpeg 许可、损坏媒体、VFR/44.1 kHz/Unicode/长路径夹具与真实代理回连仍单独验收。
