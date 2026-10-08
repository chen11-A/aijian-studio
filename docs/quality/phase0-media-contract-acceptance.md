# Phase 0 媒体时间基线验收记录

日期：2026-08-04

Backlog：M01 `media-contract`

规格：[Phase 0 媒体时间基线契约](../specs/phase0-media-contract.md)

## 已证明范围

- JSON/TypeScript 边界使用安全整数，不再把 int64 静默传入 JavaScript `number`。
- `MediaTimestampData` 只接受正 time base；Sequence 精确支持四种帧率与五种帧率/时码组合。
- 48 kHz 音频边界从绝对帧索引按有理数计算；`30000/1001` 的 30 分钟量级检查误差不超过半个样本，派生结果超过 JSON 安全整数时显式失败。
- `ProxyTimeMapV1` 明确使用 PTS、绑定源视频流、逐代理帧记录所选源帧，并拒绝空洞、倒序、混合 time base 和含糊重复。
- 契约及嵌套值不可变，验证后不能原地改写来绕过映射不变量。
- `GET /api/v1/media/capabilities` 保留合法 `X-Request-ID`，并发布稳定 `getMediaCapabilities` operation。
- OpenAPI `oneOf` 与生成 TypeScript 均保留四种精确帧率及五种精确时间基组合；不再声称内部代理映射已发布到 HTTP。

## TDD 与自动化证据

- RED：[失败测试记录](evidence/media-contract-red.txt)；新测试先因缺少逐帧映射与音频换算类型而在收集期失败。
- GREEN：[机器可读 smoke 结果](evidence/media-contract-smoke.json)；端点、request ID、映射构造、音频边界与 OpenAPI schema hash 均通过，且未访问外部媒体或网络。
- M01 专项：47 项通过；`media_contracts.py` 125 statements / 30 branches，行和分支覆盖均为 100%。
- Python 全量：299 项通过；line 96.95%，branch 86.39%。
- 媒体证据在 CI 中重新生成后才校验哈希，防止实现变化后继续接受旧证据。

复验命令：

```powershell
uv run pytest services/api/tests/test_media_contracts.py --cov=aijian_api.media_contracts --cov-report=term-missing --cov-branch --cov-fail-under=100
pnpm evidence:media-contract
pnpm contracts:check
pnpm test:py
pnpm evidence:check
```

## 尚未证明范围

M01 不是 M02/M03 的替代证据。本记录没有证明 ffprobe/FFmpeg 可用、CFR 代理真实生成、
44.1→48 kHz 重采样质量、损坏媒体隔离、Unicode/长路径处理、逐帧映射持久化、30 分钟真实 A/V 漂移、
播放或导出。上述项目继续保持未完成，必须用固定媒体夹具和真实运行结果验收。
