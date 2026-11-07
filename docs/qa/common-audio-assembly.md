# 共用四轨粗剪：本机能力与验证

这片接通剪辑页的已成镜子集自动粗剪及流水线的全镜合成，消费现有共用混音计划、包络、片段/整轨音量、重复和一次对白 duck。没有新增供应商请求，不用低级 `film:assemble` 作为新入口的回退，也不生成 QC 审核回执或发布文件。

## IPC 与来源边界

`@aijian/contracts/film-assembly` 仅包含中立 DTO。主帧桥提供：

- `assembleFilmProject({ projectId, expectedHash, expectedSelection }, operationId?)`：选择仅含按工程顺序的镜头/版本 ID，最多 128 项。
- `cancelFilmAssemblyOperation(operationId)`：复用原操作 ACK，`REQUESTED` 不是进程已停止。
- `onFilmAssemblyProgress(listener)`：独立频道；返回取消订阅函数。

主进程读取实际 `record.id`、完整 raw hash、当前选版，沿既有 resolver 校验根目录、归属、固定工具和每个源 SHA。resolver 返回已经核验的 native/visual canonical 身份，join 只消费这些固定身份，不再从可变 alias 重新选择源。提交队列内、实际复制后再次核对工程和源；renderer 不传媒体路径或 filter。产物位于本集私有唯一目录，原文件、其他版本和旧粗剪不覆盖。

`ASSEMBLED`/`PARTIAL` 的 `projectHash` 等于请求 hash，main 不保存工程。renderer 通过原保存 lease 只合并粗剪引用，保留期间合法到达的波形元数据及未涉及的当前字段。存盘失败仍显示未保存，不把原 `release()` 的失败变成未处理 rejection。

## 时钟、字幕与部分结果

回执含实际所选源的 `durationSeconds` 和有序 `shots[{ shotId, takeId, startSeconds, durationSeconds }]`。未成镜的预计秒数不计入该时钟。编辑页的整片播放、明确按镜跳转和 I/O 使用实际时钟；时间线盒子仍展示镜头计划，界面有明确说明。播放 timeupdate 不抢走当前编辑镜头；当前播放镜头与所选镜头不同则拒绝标范围，用户先明确定位。局部重做的 provider/预算/原 ABI 不变。

时钟只在会话内缓存，按项目、真实选版及实际混音/字幕输入绑定，不写工程或 ZIP。重启/导入缺缓存时仍可播放原整片，禁止猜测按镜跳转和范围标记，提示重新合成。修改真正消费的音源、绑定、trim、gain、loop、enabled、包络、整轨设置或字幕会使旧时钟失效。波形 peaks/分析缓存、许可来源和组元数据不会单独触发重渲染；同路径 bytes 的外部变化没有后台文件监控，下一次实际 main 操作会重新核 SHA，缓存不是文件授权。

可靠布局 cue 只用于现有字幕渲染，不当逐词/语音对齐。缺少完整有效 cue 时保留原 native 外观，并要求 native 与实际 clean 时钟相同；不同则明确失败。没有完整观看、试听、对白完整性或画面动作节拍已经核验的承诺。

真实 join 完成后，声音混合、明确开启的音量整理或字幕阶段失败，只有在所有子进程 settled、最终工程/源复核后才返回 `PARTIAL`，并标明首个未完成阶段 `audio | loudness | subtitles`。保留最后已完成的私有文件；流水线进入 `needs-input`，不自动重试、继续、检查或发布。取消、源不可信或输入过期不给 artifact 回执。完整或部分流水线产物已有匹配时钟时，进入剪辑不会自动重复合成。

## metadata 与 lease 调度

初次进入编辑先让原波形普通保存/读取/最终保存完成，并等待属于当前快照的混音 preview 明确结果或真实 unsupported，再为该 consumed-input revision 准入粗剪 lease。准入按 revision 锁定，合法波形新引用不取消在途粗剪；真实消费字段改变仍取消旧操作。没有修改全局保存队列、增加付费重试或用超时冒充 metadata 成功。

## 已实际执行

- desktop 5 文件 28 项通过：新真实粗剪/桥/取消，原操作及 QC 取消、共用计划。真实 FFmpeg 检查四轨分离频率、时窗、包络和 duck、无双配音、可靠字幕、实际源时钟、alias 改向、晚变工程/选版/bytes、三种 partial；真实 managed 子进程 PID 退出后及私有暂存清理后才 stopped，原字节不变。日志 `/tmp/common-assembly-desktop-final-tests.log`。
- 收尾 ESLint 要求把清理失败的固定异常移到 `finally` 之后；受影响的 assembly/bridge/operation 三文件 19 项再次通过，不与前述 28 项累加。原真实混音媒体文件另有 10 项通过（`/tmp/common-assembly-last-cleanup-tests.log`、`/tmp/common-assembly-original-mix-media.log`）。
- web 11 文件 321 项通过：包含完整 Pro 宿主、真实流水线、实际时钟 I/O、late/cancel、partial/存盘失败、双 metadata hold 与合法波形新引用、原 wave/mix/preview、notice 完整性。日志 `/tmp/common-assembly-web-final-tests.log`。
- 编译 desktop dist，原 contracts runtime builder 生成 38 个公开导出；隔离复制编译文件、CJS contracts 和固定 QC 四模块，真实合成 1 秒短片，核源字节/工程不变且没有仓库运行时导入。日志 `/tmp/common-assembly-contracts-runtime.log`、`/tmp/common-assembly-isolated-runtime.log`。

以上为本地合成夹具和受控桥测试，不是会员、用户工程、Windows/Electron 实机窗口或完整云端质量门的证明。浏览器正向门与最终整合由总控另行记录。

正式 `pnpm typecheck:ts`、`pnpm build`、`pnpm lint` 均退出 0；完整 ESLint/Ruff/Prettier/Ruff format（569 文件）通过。原 `pnpm contracts:generate` 无 OpenAPI/generated 变化，提交后执行原 `contracts:check`。初次 lint 的测试类型 inline import、未使用 import 和清理 `finally` 写法已收口；初次全格式检查的三个测试文件也已修复，未降低规则或改超时。
