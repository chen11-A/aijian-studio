# 整场确认：受限终态诊断，原等待不改

source a909 / run 42367161023 的旧 scene 公开单条为 1920×1080、16:9、confirm-remove，cases251 等直达成功句失败。catch 的 assemblyScope=native-changed 仅说明较旧就绪 marker 后出现了另一操作，不能推出该 marker 导致 251。加入片段后的正常重新合成也会变 operation。未据此改业务或放宽成功等待。

真实消费者目前有直达“声音已加入并保存”和保留后来编辑后的明确 rebase 成功句；本机未复现该云端单条到底落在哪一条，故不盲 OR 两句、不删除确认/完整 raw/组证明/次数/几何/0 provider 断言。

本片仅增加合成 ABI 的被动诊断：在原有 hash await 的原位置记录 scope/CAS/review-body 匹配、原提交前两次 CAS、固定返回 kind/code；不增加 await/hash/save/重试，不改变默认模式、计划、receipt 或任务顺序。case 失败时读取有限计数及固定 saved/rebased/stale/unknown 布尔，不返回 DOM、正文、ID、SHA 或地址。

公开注释二次白名单：固定 reply 枚举、真 boolean 或 unknown、0–4096 正常整数/unknown，仍最多八条。PENDING 仅表示合成 RPC 还没有被记录为明确返回，不代表真实 PID、provider 或文件状态。未知和 partial-ack 不由诊断变成成功，原 cases251 等待原样保留。

默认真实 scene fixture 单次完整 lane apply 契约额外核 matched/CAS/ADDED/nativeWrites 和完整组不变；隐私负例注入 PRIVATE/Infinity/NaN/伪 boolean，均不得进入注释。当前基线全 121 契约通过（`/tmp/scene-apply-readiness-all-contracts-final.log`）；这个数量不含另一分支刚交的 history 增量，根会在合后复核。目标 ESLint、格式、Node syntax/diff、workflow 不变另验。本片是取证工具，不称已修云端失败或新 scene 正向。
