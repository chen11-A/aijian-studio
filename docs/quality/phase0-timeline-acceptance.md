# Phase 0 基础时间线验收记录

状态：PASS（M03）

对应规格：[基础时间线与 1080p 导出](../specs/phase0-timeline-export.md)

## 已证明

- `TimelineVersionV1` 使用不可变、版本化的整数帧模型；clip/asset ID、revision、帧范围、总时长、
  代理 timebase 和 JSON safe integer 约束均有失败测试。
- trim、reorder、replace 都要求 `expected_revision`，成功只产生一个新 revision，陈旧写入和 no-op
  被明确拒绝，原版本保持不变。
- render plan 不含绝对路径，固定绑定 timeline hash、输入内容 hash、Clip 帧区间和由绝对帧换算的
  48 kHz 样本区间。
- 锁定 FFmpeg `8.1.2` 从 M02 的 CFR 代理真实导出 1080×1920、25 fps、30 帧、48 kHz、
  H.264/AAC MP4；输出 hash 为
  `b208d1d60d41d2f6e72e11be8ff88f4928c7a6765a29ec86f9dc0726d8fb193e`。
- 黄金编辑依次执行 trim、reorder、replace，最终帧顺序为
  `30–41 → 2–9 → 15–24`。成片解码、裁出实际画面区并缩回源尺寸后，逐帧内容均以源代理
  对应帧为最佳匹配（允许代理中相邻重复帧等价），最大平均绝对误差为 `2.551`，低于固定阈值 `3.0`。
- 输入/输出 hash、CFR/尺寸/帧数/音频、编码失败、输出竞争和 no-clobber 发布均在测试或证据中验证。
- 29.97 fps 回归证明源 `[1,2)` 的 1601 samples 不会缩短时间线首帧所需的 1602 samples；每段按
  Timeline 累计边界 trim/pad；AAC packet timing 与 skip/discard metadata 还原出的连续展示区间
  必须精确等于逻辑样本长度，编码 frame 填充不再被当作展示样本。该分支使用仓库锁定的
  `cfr-30000-1001-48000.mkv` 真实导出一帧，成片 hash 为
  `a978457bfe8626a800166b80c187a3bbc71dca768f0353e915498e2c4f861f9e`。
- 导出资源上限、单并发 worker 和显式用途门已生效；当前 `PRODUCT_EXPORT` 失败关闭，只有
  `DEVELOPMENT_EVIDENCE` 能使用锁定的 GPL 开发工具链。

## 重放

```powershell
pnpm timeline:verify
pnpm evidence:timeline-golden
pnpm evidence:check
uv run pytest services/api/tests/test_timeline.py services/api/tests/test_timeline_render_plan.py services/api/tests/test_timeline_export.py
```

证据文件：[timeline-golden.json](evidence/timeline-golden.json)，由 `SHA256SUMS` 绑定。

## 明确未证明

- 本证据使用 CFR 代理作为编辑和基础导出介质，不证明 VFR 原片在线重连、30 分钟代理到原片漂移、
  多轨/转场/调色/混音或专业 NLE 能力。
- 当前 `libx264` 来自 GPL、`DEVELOPMENT_ONLY` 的开发工具链。本结果不批准把该二进制或编码方案
  随 Apache-2.0 安装包发行；发行工具链与对应源代码/NOTICE 仍是单独 Gate。
- 黄金夹具是合成素材，不替代真实手机 VFR、真实对白和影片团队的观看验收。
- 黄金中的 primary/alternate 是同一批准代理的两个逻辑引用；replace 的 revision、asset ID 和 render-plan
  hash 已证明，但这条像素证据不声称证明“替换为不同画面”。不同内容 hash 的替换选择由独立 render-plan
  单元测试覆盖，后续影片验收仍需第二个可辨识代理素材。
