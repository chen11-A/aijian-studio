# 最终文件中立交付清单

本片把 main 私有 Prepared 的真实检查事实接到实际发布文件，不增加检测器、生成服务或收费调用。合同首检查点为 `79295696738f9081b58d8ec4b63a58fe865cf34e`；最终原生提交另含 NodeNext `.js` 类型引用修正和可选 `cleanupUnconfirmed: true`。

## 导出文件名（2026-11-11）

用户已裁定默认名撞名自动加序号（选 A）。`defaultNameCollision` 是 `"suffix"`。

- 检查和发布可以带可选 `requestedFileName`。不传时基名是系列名-集名，再经 `safeExportName`。传入时基名是清洗结果。检查结果 `fileName` 是这个基名（选文件夹之前还没有序号）。发布路径是实际写入的文件名。
- `/` 和 `\` 按非法字符删除，不当成路径再取最后一段。控制字符、空白和其他 Windows 非法字符同样删除。设备名含 `CON`/`PRN`/`AUX`/`NUL`/`COM`/`LPT`/`CONIN$`/`CONOUT$`，加前缀 `_`。截断按 UTF-8 字节，不切断 emoji 或代理对。空名或洗完没有词干是 `EXPORT_NAME_INVALID`，文案「导出文件名是空的，或只含不能写入文件名的字符。请改一个名字。」不写成 `aivora-film.mp4`。
- 单画幅第一次是 `基名.mp4`。双画幅第一次是 `基名-16x9.mp4` 和 `基名-9x16.mp4`。不再把收据号拼进文件名。`film-export-qc.test.ts` 里原先按收据号拼预存路径的用例因此改成清洗后的实际名。
- 没传 `requestedFileName` 时，基名或它的 mp4/srt/封面被占用（大小写不区分，双画幅算同一套）就整套改用 `基名-2`，再冲突用 `基名-3`，双画幅两个文件用同一个序号。不覆盖已有文件。序号到 99 仍被占，或 `link` 的 `EEXIST` 竞态把序号用完，返回 `EXPORT_NAME_EXHAUSTED`，文案「默认导出名的序号已经用完，请换个名字或换文件夹。」竞态时先删掉这一轮刚链上的文件，再取下一个序号。
- 用户编辑过的名字撞名仍是 `EXPORT_NAME_TAKEN`，文案「已有同名文件，请换个名字或换文件夹。」不加序号。
- 撞名判定在作废收据和删除渲染目录之前一次做完。编辑名撞名或序号用尽时，收据和渲染结果都还在，可以换文件夹再发。不会先写出一个画幅再返回丢掉错误码的 PARTIAL。有声源超过两声道是 `UNSUPPORTED_AUDIO_CHANNELS`。

## 导出声音决定与过期素材（2026-11-11）

- 清单可选 `audioDecision`，取值只有 `SILENT_BY_USER` 与 `WITH_AUDIO`，与 `sound-export-decision.ts` 相同。缺字段是旧记录，读取为未记录，不从 AAC 轨反推有声。损坏值使导出失败，代码 `AUDIO_DECISION_INVALID`，文案不是「检查请求不完整」。
- `SILENT_BY_USER` 写入一条 48 kHz 立体声静音 AAC，时长是视频流实测秒数。不设容差门，也不因源音轨超过两声道而拒绝这条静音路径。`WITH_AUDIO` 仍拒绝非单声道/立体声源。
- `MATERIALS_STALE`：混音计划含 `STALE_CLIP_IGNORED` 或 `SCENE_AUDIO_BINDING_STALE` 时，导出在编码前失败。请求没有确认后仍导出的字段。粗剪和试听仍只把这些情况记成「未混入」，不在这一片改成拦截。

## 事实与边界

- QC schemaVersion1、原规则、严重度和超时不变。可选 main-only `onMediaInfo` 只投影同一次既有 ffprobe 的尺寸、平均帧率、codec、像素/色彩标记和音轨信息；没有第二次媒体检测。平均帧率不担保 CFR，缺值明确 null/unknown，不从质量设置或计划秒数补值。
- Prepared 留下独立技术投影、QC 安全统计和原未验证项。选材仅描述真实 shot/take 身份；人读标签优先实际 scene.no、shot.no、take.index，不用列表顺序冒充版本号。缺索引时版本未知，缺镜号才明确“选材第 N 镜”。不包含原始 probe、路径、凭据、owner 或 qcReceipt。
- 发布仍须用户明确确认，原 owner/工程/选版/settings/SHA/单次 receipt 门保持。公开文件与各实际 sidecar 在复制后按 SHA、字节数和 BigInt dev/ino/mtimeNs/ctimeNs 复核；临时 JSON 放在目标目录的独占私有子目录，保证与最终文件同卷。JSON 用 wx 写入、hardlink 排他发布，不覆盖用户文件。
- 清单 schemaVersion1 只列真正保存的相对文件名、SHA、字节、技术事实、实际导出 settings、QC 摘要与所有未验证项。SRT/封面失败不按预期补列；旧用户同名文件不会被说成本次已交付。完整播放/试听、对白完整、连续性、口型、烧录字幕等仍明确未验证；QC 仅首条非封面视频轨和首条音轨。
- JSON 未写或无法核验时返回 FAILED 证据、overall PARTIAL 并保留真实文件引用，不自动重发/重写。legacy 缺证据字段明确未提供；清单本身不是授权，也不进入 FilmProject/history/工程包成为可恢复权限。
- 若公开 JSON 已落且 SHA 可证、随后仅私有暂存 rm 失败，保留 WRITTEN 事实和原 manifest/hash，不改写公开文件；overall PARTIAL、`cleanupUnconfirmed: true`。若全部文件已落，JSON 中原 complete 仍真实描述文件交付；清理状态是独立维度。尚未公开 JSON 则 FAILED＋同标记。main-only cleanup 标记与原 finish(stoppedConfirmed) 合取，清理未确认绝不发 stopped。默认 export/assembly 行为不变。

## 实测

- `/tmp/delivery-evidence-final-native-targets3.log`：最终同源 8 文件 56 通过，49.40 秒；包括真实双画幅 render/QC/publish、JSON 内容/物理 SHA、源 bytes 保留、篡改、预存文件不覆盖、真实 managed-cancel/IPC、单次 receipt、完整/部分 sidecar、cleanup 故障，以及原 assembly 回归。
- `/tmp/delivery-evidence-assembly-bridge-regression.log`：实际文件 `film-assembly-bridge.test.ts` 另 2 项通过；不将不存在的 ipc 文件参数计为已运行。
- `/tmp/delivery-evidence-cleanup-facts-after.log`：2 文件 14 项阶段通过，与最终范围重叠不相加。最终还含真实已写清单/cleanup 故障、accepted stop＋cleanup 失败不误确认两维回归。
- `/tmp/delivery-evidence-qc-observer-tests.log`：原 11＋新 1 共 12 Node 用例通过，无 skip。新真实合成媒体验证只产生原 probe/视觉/音频 3 个进程，报告 schema 不变，技术事实不含路径。
- `/tmp/delivery-evidence-resource-collection.log`：现三 collector 原 Python 收集参数 3 通过。`/tmp/delivery-evidence-staged-runtime.log`：三份真实 staged 资源经实际 compiled main loader 运行并得到真实 codec/fps/音轨事实，仍各 3 进程；此证明 loader/metadata 路径，不冒充 Windows 用户窗口或完整安装包。
- `/tmp/delivery-evidence-final-types2.log`：正式全工作区 TypeScript 通过。`final-build2.log`：最终 cleanup 源的工作区 build 通过，原音效资源 206/464 未变。`final-cjs.log`：实际 contracts runtime builder 通过（41 public export，包括主入口；另有编译闭包文件）。
- `/tmp/delivery-evidence-final-eslint2.log`、`final-prettier2.log` 和 diff 检查通过；API、schema、费用、锁与依赖未修改。原 API 全门不由本片定向结果替代，共享 QC 的 Python 消费边界仅上述资源收集。

首失败保留：`delivery-evidence-native-types-stage.log`（新测试 seriesId/NodeNext 类型引用）；`final-native-targets.log`（39过/1失败：PARTIAL catch 漏证据已修）；`cleanup-before.log`（rm 被忽略的诊断）。清理诊断的最初测试曾把两维合并要求 FAILED，review 后改为保真实 WRITTEN＋独立 cleanup 标记，未把公开文件真实存在说成不存在。

未调用真实会员/付费提供方。所有媒体为本机合成；实际全长人工观看/试听、Windows 用户窗口与最终 UI 联合门由总控另验。

## Windows 临时目录别名夹具（source 517b8c2 后独立修正）

真实 publish 在 `film-export-qc.ts` 先 `realpath` 用户选择的目录，再派生输出文件并交给清单函数。清单拒绝非 canonical 目录的门保持不变。原单元夹具只 `resolve(mkdtemp/output)`；Windows 临时根可能包含 DOS 8.3 名称，不能把这串当 canonical 输入。

正常夹具现在创建后按实际 main 流程 `realpath`。新增真实目录 alias/junction 对照：旧 `resolve` 输入得到 `EVIDENCE_UNAVAILABLE/files:[]`，未进入最终 current guard；同一文件由 BigInt dev/ino/size 和完整 bytes 证明身份后，canonical 目录输入成功写出，清单 SHA、视频 SHA/bytes 与原字节保持。原部分 sidecar、排他提交、不覆盖、取消、cleanup-unconfirmed 断言全保留；未改产品/工具/阈值/timeout。Linux 受控十项通过仅证明该差异，真正 Windows 正常 CI 仍须复验；另一个 ownership 五秒超时未在本片定位或修复。

快速 Windows 复验在原 `speech-window-windows` 的原 17 项步骤之后安装 frozen JS 依赖，固定 `pnpm test:delivery-manifest:ci` 只跑原清单/ownership 两完整文件。Linux 实际 launcher 为两文件 11 项（清单 10、ownership 1）通过；另清单+curated 投影两文件 14 项、正式 desktop 类型通过。诊断 self-test 28 项保留原默认/speech/library 行为，并验证固定 argv、真实 child 0/23 透传、额外参数 0 spawn、安全注释不含私有参数；原 streams、全 quality/coverage、原 timeout 均未改变。新增 CLI 首次测试自身在建 pnpm fixture 前解析它导致 ENOENT 的失败保留在 `/tmp/windows-manifest-diagnostics.log`，只修 test setup 顺序后 self-test 全过，不是生产故障。
