# 第38批：有界全产品核对与全分集读本编辑

总基线 `32d014624aad134a6884121a58a26b75088104c9`，直接父提交 `edadc0ed9072d51f13ee6b1ab126d323c7a3d11f`。仍在本地 `codex/aivora-product-local-20261011`；不推送、不合并或改远端。36/37封存候选、原失败和转移证据保留。参考远端刷新先前失败，未以不可读远端状态静默换基线。

## 有界产品核对

[完成度核对](../product/AIVORA-全产品完成度核对-20261011.md)对23页、10项全页交互、5项跨页要求和10项验收场景逐项区分代码证据、受控实际局部操作、缺实现、协议/产品取舍和Windows/真实调用依赖。输入42项在[root/SOURCE_INPUTS_BEFORE.json](evidence/aivora-batch38/root/SOURCE_INPUTS_BEFORE.json)，锚定第37批真实文件字节；新代码前输入身份保留，不改写为新版本。未穷尽每个按钮变体，原Word未逐页核对。

[专业体验五项发现](../product/AIVORA-专业体验五项发现-20261011.md)供白天汇总：正式媒体生成、声音生产、实时成片监看、空间/上下文效率、正式审片交付。旧33时间码/缩放和37核对按钮裁切已按34/37证据关闭；只读状态、人工观察或LOCAL_IMPORT不算缺失媒体能力已经实现。

## 唯一实现及操作

P07完整基线要求“场次/动作/对白编辑、增删排序、读本检查、版本确认”。原生产编辑器只显示当前场次。新增全分集读本直接按现有顺序显示并修改动作/对白、段落类型/说话人/呈现方式，复用ScriptSceneBlocks及同一个scenes草稿；可进入确切场次继续编辑。聚焦场次仍发布该场次的助手选择，未默认上传整本。两阅读范围切换不写数据，不确认、不派发。

修改仅4个源码/测试文件：EpisodeScriptEditor.tsx、EpisodeScriptEditor.test.tsx、ScriptReadthrough.tsx、v2-story.css。普通/专业走同一路径；原场次编辑保留。没有新API/IPC、存储、权限、Provider、费用或正式声音读本批准对象。保存仍走原immutable script版本、CAS、精确回读及dirty/UNKNOWN保护；切作品/分集重置阅读范围，未保存输入离开仍需原guard。

旧剧本UNKNOWN的显式结束路径在读当前head后允许结束日志，界面明确“未归因原提交结果。下一次保存是新操作”。此为既有代码边界，非本批修复，未新增生产P1故障声明。新增测试只证明阅读范围切换不能解除/修改原journal或重发；不能写成整项精确原保存归因已经完成。

## 定向检查与实际证据

- renderer两文件31项通过：4项新增覆盖双场同草稿保存/重开、确切场次排序删除与其他身份不变、dirty离开取消/新分集reset、UNKNOWN journal逐字节保持且不重发；27项既有覆盖依赖/坏回执/异步/旧版本等。最后仅workspace heading隐藏做一致性调整，相关31项与typecheck重跑通过，前次日志保留且不重复计数。
- renderer typecheck、3 TS文件eslint、4源码文件prettier通过。无构建、安装或新全量测试。API/native/contracts没有变化，复用37已通过合同与对应后端/native证据；[UNCHANGED_PROTOCOL_SURFACE.json](evidence/aivora-batch38/root/UNCHANGED_PROTOCOL_SURFACE.json)列旧路径树身份与工作区零差异，不能据此扩成新全链验收。
- 实施者受控Chromium实际鼠标/滚轮/键盘，生产localhost renderer→未修改的实际desktop client→authenticated ASGI→自有SQLite。1440×900普通与980×680专业各完成两场动作/对白编辑→单场往返→一次显式保存→重开；完整content精确只改两文本，parent/revision正确，旧版本及另外三个scope完整data未变。两组最终PASS不是独立审核或Windows实测。
- 保留原测试脚本失败：第一次精确label匹配包含textarea初值，0 POST；只读诊断确认region/内容存在，0 POST。第二次误按原envelope读取实际FOUND.receipt，已成功一次201后验证脚本失败；保持其DB/回执，未重发。修正脚本后另两自有DB每组各1 POST，全部实际3 POST/194 GET/197完整响应体canonical hash、5 case DB文件/全表logical hash见[ACTUAL_RECORDS_VERIFIED.json](evidence/aivora-batch38/controlled-browser/ACTUAL_RECORDS_VERIFIED.json)。两个失败不计为完整业务通过。
- 夹具独立setup两个真实brief/四个真实script，非UI操作/审批；复用37只读种子原SHA不变。没有确认POST、真实账号凭据、模型/声音/媒体调用。worker只允许只读bootstrap与script/versions写入。dev及workers已停止，[OWNED_DEV_STOP.json](evidence/aivora-batch38/root/OWNED_DEV_STOP.json)仅云端本批进程，无用户电脑重启。

[root](evidence/aivora-batch38/root/)保留argv/cwd/UTC/exit、重跑/失败日志、只读SQL错误诊断。后续SQL记录核验脚本亦保留一次a.id列名误用失败及修正版；协议复用检查的一次不存在packages/shared子树误用另以实际tool返回摘要记录，未冒充原stdout。不称产品故障。全staged Git whitespace检查发现两个Vitest原stdout尾空行（exit 2）；8个产品源码/文档限定检查exit 0。两个原stdout逐字节保留，没有修改CI配置或声明全staged格式门通过。完整实际页面截图、trace、HTTP原响应、5个DB及夹具在[controlled-browser](evidence/aivora-batch38/controlled-browser/)；只不复制本次新产生的临时Vite缓存，没有排除任何旧归档/失败/字体。最终4源freeze及新证据manifest另存。

## 未验证与后续依赖

两万字/完整长稿读本性能、原创创作质量、真人读本、正式SoundApproval/TTS、MLT实时成片、多轨真实播放、正式审片/master、预算两问及媒体能力协议、Windows安装/窗口/真实解码/关闭升级恢复均未通过。新项目create原操作持久归因及旧脚本UNKNOWN显式结束的归因边界仍开放。专业右栏/大监看A/B尚未向用户问，不称用户欠答。真实调用每次仍需完整账号/模型/内容/费用额度确认。普通/专业质量与数据权限不缩水，DRAFT限额不变；原安全审计、CI/覆盖率门及全部失败证据保留。

本批以小型增量源码补丁和文件hash交付，精确依赖37封存候选；不再重复制作完整旧证据/字体卷。旧37完整还原证据复用；本批另验证增量Git index/tree，不冒称重新跑全历史还原。Library不重试，没有正式保存ID或新下载链接；本地路径仅供父线程/云端工作区读取。
