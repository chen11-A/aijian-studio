# CI-01：Windows 下载失败修复

失败提交：`a6fbbf1e957d5d888bfedfa4e7679dd527842d3e`。

证据：[workflow run 41839839437 / Windows job 126608181202](https://github.com/chen11-A/aijian-studio/actions/runs/41839839437/job/126608181202)。`Prepare exact Windows development media binaries` 步骤在 `scripts/ci_media_tools.py:37` 的 `urllib.request.urlopen` 收到 `HTTP Error 503: Service Unavailable`（2026-11-04T13:38:30Z）。该次 Windows 的合同检查、lint、typecheck、test 和 build 尚未运行，不能把它描述成业务回归失败。

修改 `scripts/ci_media_tools.py`：固定地址、版本和 SHA-256 均不变；对 HTTP 408/429/500/502/503/504、连接中断和超时最多尝试3次，等待2秒、4秒。403/404、非HTTPS跳转、超大小和哈希错误直接失败，不降级、不跳过校验。每次下载先写同目录唯一临时文件，校验通过后原子移动为缓存；传输中断移除本次临时文件，验证失败保留独立临时文件用于诊断，绝不将错误字节存成正式缓存。已有错误缓存仍拒绝并保留。

针对性检查：`services/api/tests/test_ci_media_tools.py` **16通过、0失败、0跳过**；两修改Python文件 Ruff check/format 通过；`mypy scripts/ci_media_tools.py` 通过。测试全为模拟网络，不证明外部下载源已恢复；最终 Windows CI 结果需另行记录。旧断言“失败字节留在正式缓存”更新为“正式缓存不存在，验证失败字节留在唯一临时文件”，并补充重试次数、503恢复、读流中断、403/404不重试和哈希错误不重试断言，没有取消原校验要求。

## 持续503后的官方镜像修复

后续 run41848482684 重试3次后仍返回503；run41849572744的Windows仍在同一步失败，有限重试无法解决持续的原站故障。

发布者的 [GyanD/codexffmpeg README](https://github.com/GyanD/codexffmpeg) 明确 Releases 为 gyan.dev 官方镜像；[8.1.2资产清单](https://github.com/GyanD/codexffmpeg/releases/expanded_assets/8.1.2) 的 `ffmpeg-8.1.2-full_build.7z` 摘要与现有固定值一致。实际从该清单链接下载到本执行器 `/workspace/p3j-media-cache/ffmpeg-8.1.2-full_build.7z`：166721853字节，SHA-256 `0fff188997a499b5382e0f66e845d4556c48c54f0113ebed4853d556dbdd7059`，与固定值逐字一致。该文件未加入Git，不能假称已存在于GitHub Windows runner缓存。

现增加仅瞬态故障后的固定官方镜像切换：第一次原站，后两次镜像，最多3次总尝试。403/404、非HTTPS、大小或哈希校验失败仍立即拒绝，不能借换源忽略权限或完整性错误。版本、固定摘要、解压和二进制准入校验均不变。针对性pytest更新为17通过、0失败、0跳过；Ruff check/format、脚本mypy通过。实际Windows CI仍需后续确认，不能据本机成功就宣称远端通过。
