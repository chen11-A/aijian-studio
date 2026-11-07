# 验收：网页拒绝用例的模型目录边界

独立分支基01db481，未改正在原完整验的初始恢复树，未合939 auto-source。仅测试与此说明，不改src产品、依赖或workflow。

## 失败与受控证据

50a6a3e CI run42417256290 / Linux job128537925528 的 `ProWorkspace.test.tsx:1129`：`refuses a draft the catalog does not list and a page without a project` 找不到原“网页里不能直接出片”。完整annotation最终root为sample open / board / data-generate on，但截断没有生成面板，不能凭最终DOM断派发时已就绪。

同文件既有 `openSample()` 在CONNECTED后还等真实 `.pro-root[data-generate=on]`；本例第二render无projectId却只等CONNECTED。产品modelIds初始空，另一个effect在connected后等待实际models回执；runGeneration捕获当时能力gate。若目录尚未完成，得到模型拒绝，目录之后到达不会自动重放。

- `/tmp/acceptance-browser-generation-original.log`：原本地目标1通过/140未选；不冒复现旧CI。
- `/tmp/acceptance-browser-generation-controlled-before.log`：延迟同一实际models回执，CONNECTED后释放但不等React目录就绪而连续点击，精确重现原网页拒绝找不到（1失败/140未选）；失败最终DOM也为data-generate on。不是改产品模型结果或构造新拒绝。

## 最小修复与永久回归

从原openSample原样抽出catalog-ready观察函数，原helper仍调用它。本例第二次无projectId render保留受控回执门：目录未到先明确用户确认，断原模型缺失提示且0视频/图；交付后等待同真实data-generate on，断0自动生成及尚无网页拒绝；用户再次明确确认后才断原网页限制。原后台队列、再试一次、draft/lite缺失及全部精确文字断言保留。末尾额外锁prepare/image/video均0；模型回执只调用一次，测试失败时也释放自己的门。

没有自动重试旧动作、调整原超时、skip或降低阈值，不把CONNECTED或最终可生成状态当较早动作的准入证据。

## 验证

- `/tmp/acceptance-browser-generation-controlled-after.log`（最终前阶段）、`...-target-final.log`（最终）：原用例完整目标通过，包含延迟目录拒绝→不自动重放→明确新动作的永久回归。
- `/tmp/acceptance-browser-generation-capabilities.log`：原实际capabilities纯层3项通过 / 775ms。
- `...-types.log`：正式web类型；`...-eslint.log`、`...-prettier.log`：owned静态/格式及diff0。
- 未跑整文件141或完整web，不拼阶段数字。修后CI由root串行验证，未提前称远端已关。
