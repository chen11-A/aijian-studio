# 单镜自动配声只读建议

本切片提供 `suggestBundledFilmShotAudio`：exact 四字段 `projectId / expectedProjectHash / shotId / takeId`，只读当前单镜实际所选版。返回 `SUGGESTED` 的完整片段、来源说明、包络、固定限制和指纹，或者原固定失败码。它不复制素材、不保存工程、不调用供应商，也没有批量选用界面或执行入口。原单资源 add 不能代替本建议的多片段执行。

## 资源和运行时

复用原 `audio-picker/index.ts` 与 `synonyms.ts`，不复制匹配算法。共同资源 builder 编译两模块，并在原资源索引固定各自 SHA256。公开 `pickerSha256` 是 `SHA256(JSON.stringify(["audio-picker-runtime-v1", entrySHA256, synonymsSHA256]))`。模块依赖带 synonyms 内容 pin；加载和结束时同时复核两个模块、索引与 canonical 根。没有源码 loader 回退。

当前资源为 206 条（175 音效、31 配乐），464 个收录文件，保留原来源、作者、许可与证据。原清单 SHA256 为 `fa02bc97deb0786e80759fdcb9cbe5b6ea03acd2fca52701cfae8dbd9b09d3cb`。三种 collector 的真实 staged 产物及开发布局，均按实际 main 根选择加载完整 206 条和两个已编译模块；这不是完整安装包或用户窗口验证。

## 时间和创作语义

时基来自现可信 selectedSources 的原片/clean 实际 probe，忽略未成镜和无关旧音轨。首尾复核完整 raw hash、选版、每个实际源 SHA、实际时钟、库及 picker 身份。相同 factory 的 inspect/add/suggest 使用同一 BUSY 生命周期；返回后释放，不在用户审核期间持锁。

只使用本镜及其场景的明确创作描述、已定 musicMood 和明确有限且位于实际镜长内的动作时间。显式 0 秒有效；未知时间不猜。仅过滤原 picker 已知的无明确时间设备自动 0 秒提示，其余匹配仍由原算法决定。没有 mood 时提示待决定；显式无配乐尊重留白；“克制”和“克制但紧张”沿原算法区分。计划时间不宣称像素或语音对齐。

完整保留多资源 segments、sourceStart、负 fade origin、各 fade 乘积及 ambience 最终 automation；场级 ambience master 编译一次。music 起始 clip gain 为手动默认 0dB，不重复响度补偿或 duck。包络复用共享 evaluator 的 base/delta 语义。原生已占轨计入 128 上限；超限明确失败，返回上限和已确认的最少所需段数，不截断。没有执行任意滤镜或返回磁盘路径。

## 审核指纹和并发校验

`projectHash` 始终是当前完整 canonical raw hash。每次请求仍须精确匹配，保存时间变化也会拒绝旧 raw 请求。`planFingerprint` 是另一种语义 digest，不作授权：固定版本、project/shot/take、规范创作 context、混音设置、按 native/visual 角色绑定的实际源 SHA 与时钟、catalog/picker 身份、全部 clips/warnings/limitations。它排除 rawHash 和 savedAt。仅保存时间变化不使已审计划失效；创作、设置、源字节/时钟、角色互换均失效。内部 context/路径不加入公开 DTO。

后续明确选用须重算同一语义计划，对比已审指纹，然后用 fresh 完整 raw hash 作原 CAS；不得凭指纹授信路径、复用旧 raw hash 或长期锁住工程。本切片未实现该执行链。

## 实际验证

- 最终 desktop 定向：6 文件 61 项通过，33.23 秒，日志 `/tmp/shot-audio-suggestions-semantic-final.log`。其中新建议 31 项，含真 FFmpeg native/clean 时钟、BigInt 文件身份注入后的实际替换 SHA、旧工程/选版/目录/资产/模块变化、BUSY、128/129、完整原 picker 多段、只读 bytes、正常保存与语义指纹对照。其余原 native/target/IPC/preload/root 用例保留。
- 三 collector 和开发布局真实 stage：4 项通过，3.95 秒，日志 `/tmp/shot-audio-picker-collectors-first.log`。同一 builder 产物收录两模块，不三遍重建全库。
- 正式双端类型、完整 workspace build、目标 ESLint/Prettier、Python 目标 Ruff/format 均通过。原 contracts check 在提交后执行。
- 实际 desktop `dist/film-audio-library.js` 在隔离资源/app 布局下 require，使用编译 contracts CJS、真实 pinned FFmpeg、真实 canonical 文件及完整库，返回只读建议且源 bytes/工程/媒体目录不变。没有 source TS 回退。日志 `/tmp/shot-audio-suggestions-isolated-runtime.log`。

未调用会员或付费服务，未声称已听过、已自动选用、已做动作/语音对齐或 Windows Electron 安装包验证。当前范围仅单镜建议；整场连续环境和跨镜执行另行实现。
