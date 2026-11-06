# 本地音效库：显式选用的 native 首切片

本轮只接可信目录、按镜头明确选用单资源、复制与保存，不代表完整 4B-B05 自动匹配完成。没有会员、供应商或网络调用，不自动播放、不覆盖原片，也不重复实现混音器。

当前 `manifest.json` 实际为 **206 条：175 音效＋31 配乐文件**。配乐仍是 22 首独立作品与 9 个循环派生文件。当前 205 条 CC0-1.0 与 1 条 Public Domain；旧轮次报告的 207/176 口径不作为当前目录。清单 SHA-256 为 `fa02bc97deb0786e80759fdcb9cbe5b6ea03acd2fca52701cfae8dbd9b09d3cb`。本次 206 份实际 Ogg 均与原清单 SHA 一致。

`build-audio-library-resources.mjs` 编译现有 `packages/aivora-modules/audio-library/index.ts`，其 type-only picker import 不进入运行时。Windows、Linux、Linux checkpoint 以及开发 desktop build 共用这一构建器。只分发清单中当前 Ogg 与 `config/bundled-audio-resources.json` 锁定的原公共来源、许可和技术证据；不扫描未跟踪的缓存、下载响应或原始音频。462 个运行资源约 65 MiB。许可正文没有改写，公开来源与已披露的限制仍保留，许可字段本身不作新授权证明。

桥接口位于 `@aijian/contracts/film-audio-library`。目录不返回库路径；添加请求仅含工程/版本身份、两份 SHA 与有限 placement。主进程读取精确 `record.id`，复用最终混音 resolver 的实际原片、clean 视觉时钟与归属规则；验证固定工具后才 probe。复制进当前 episode 的私有目录，在原 project 保存队列内复核工程、选版、源 SHA/实际时长后写入。失败只清本请求的私有副本；若工程已写但后续索引失败，返回 `WRITE_UNCONFIRMED/unchanged=false` 并保留真实引用文件，不能宣称未修改或自动重加。

`AudioClip.libraryAsset` 保留小型来源信息，`label` 保存实际中文素材名。`processingGainDb` 是已作用于 Ogg 的处理记录，不叠加为播放增益。来源元数据不授予任意文件读取权。Ogg 仅加入现有可信根的格式白名单，原主帧授权、目录边界、读取容量与 SHA 守卫不变。工程包导入仅增加 Ogg 格式，路径、hash、总量和解压逃逸门仍保留。

当前只接受绑定所选 done take 的镜头相对 placement；不静默裁掉越界区间。非循环音源必须实际够长，只有原 `loopable` 条目可显式循环。现 picker 的多 segment、crossfade、fade envelope、连续场景环境与其独立 duck 尚未接入本切片，不能压成一段或重复 duck；最终混音/预览仍使用唯一共享计划。技术循环接缝不等于已经人工试听。

真 Ogg 的端到端回归包含：add 返回实际 stored → 真实 normalize → 原受限 readFilmMedia → 实际 ZIP 导出/新工程恢复 → shared plan → 真 FFmpeg 有声文件；并验证源 bytes、来源信息、0 dB、不重复补偿与伪造 provenance 不授信。此链发现并修复了短 Vorbis 单轨经 amix 后 NOPTS 溢出：在每轨既有延时/补静音之后，按真实样本序号重建 48 kHz PTS，未绕过 amix 或修改检测规则。原四轨频率/时窗、duck、循环、mono、取消、命令上限媒体回归仍保留。

定向命令（工作区根）：

```sh
pnpm --filter @aijian/desktop exec vitest run src/film-audio-library.test.ts src/film-audio-library-ipc.test.ts src/film-audio-library-preload.test.ts src/film-audio-mix-media.test.ts
pnpm --filter @aijian/studio-web exec vitest run src/aivora/film/audio-library-provenance.test.ts src/aivora/film/audio.test.ts
uv run pytest services/api/tests/test_audio_library_resource_collection.py -q
pnpm typecheck:ts
pnpm build
```

资源 collector 回归真实构建一次，三个入口用相同产物受控执行收录并逐文件核 SHA，每份再实际动态加载编译后的原 loader。Linux 真 FFmpeg 与沙箱 preload/IPC 回归不能替代 Windows/Electron 用户窗口验证。UI 选用入口与其 persistence lease/current-ref 迟到保护需作为下一接线阶段验收；native 成功回执不是已经完成 UI 操作。

## 单镜只读时基补充

`inspectBundledFilmAudioTarget` 只接受 `projectId/expectedProjectHash/shotId/takeId` 四字段，返回绑定这些身份的 `TARGET`、原 hash 与实际 `durationSeconds`。复用 add 的同一 target-only resolver，原片及 clean 归属、固定工具、视觉时长都依实际文件；其他未完成镜头或坏旧音轨不会牵连。完成前重新检查 canonical record、选版、原片与 clean 的 SHA/时长，最后一次 probe 后变更文件也拒绝。与同工程添加共享 BUSY 防重入，拒绝的重复请求不会解锁仍运行的请求。

此接口不读取素材库、不保存工程、不创建或复制 asset、不派发会员。回执只是当时的时基，不授权后续添加；`addBundledFilmAudio` 仍独立核验最新 hash、选版和实际来源。前端须绑定精确 live ref 与选择，不得拿 `shot.seconds`、字幕布局 cue 或全工程 mix 状态冒充本镜真实时长。

```sh
pnpm --filter @aijian/desktop exec vitest run src/film-audio-library-target.test.ts src/film-audio-library.test.ts src/film-audio-library-ipc.test.ts src/film-audio-library-preload.test.ts
```
