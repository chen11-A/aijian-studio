# 本镜声音建议：只读宿主接线

基线 `e0d5bb8`。剪辑页选定已完成的视频版本后，可打开“查看本镜声音建议”。本批只提供查看、刷新、关闭；没有添加、删除、撤销或自动选用行为。后续批量执行接口不在本交付中。

## 显示与数据边界

- 实际 `SUGGESTED` 回包按环境音、音效、配乐三轨显示全部片段、准确段数、名称/类别/场景、作者/许可/安全来源链接、源时长/可循环、镜头内计划起止/源偏移/音量/循环，以及每一项淡入淡出、音量自动变化。完整 warnings 与 limitations 不过滤为“已通过”。
- 缓存克隆完整原 DTO，不根据展示重新生成数值、指纹或请求。时间显示最多四位小数；片段相对淡化时间允许负值。包络基准音量只是计算参考，不再次相加。空轨明确未安排、配乐留白/情绪待定/无匹配，不编造素材。
- 回包须匹配请求的工程、镜头、选版及完整 raw hash，并通过全量形状/范围/段数/包络验证；任何不支持内容整份拒绝，不截断片段。不显示内部身份、哈希、原始异常或文件路径。素材来源只打开无用户名/密码的 HTTP(S) 链接。
- 这是文字创作计划与本地目录的建议，既不是生成、实际添加或试听，也不是已核验成片动作/语音对齐。文件或目录在外部被改后应刷新；本批没有文件系统主动监听器。

## 保存、失效与退出

1. 沿原 `createFilmPersistence` 获取短 lease，保存当前稿，立即释放。原手动添加/global pending/recovery/微任务保护不改。
2. 释放后读完整 raw canonical，直接算严格 `historyRecordHash(raw)`；读取建议及人工查看均不持 owner。没有 `host.apply`，不为 savedAt/directory 元数据做新整稿采用或制造 400ms 自动保存循环。读取本体零复制、零写工程、零 provider；预检可能保存用户已存在的编辑，二者分别计数。
3. 如遇明确 `PROJECT_CHANGED, unchanged=true`，只允许在 fresh raw 与上一份除 savedAt/directory 外完全相同、显示输入相同且 raw hash 确实改变时，重读后再请求一次。没有延迟轮询或无限重试，创作变化不享此例外。
4. 显示输入绑定当前工程/页面/镜头/选版、场景创作字段、镜头文字/声音/动作计划、选版源路径/时长与混音设置。savedAt/directory、波形缓存等不让已显示卡片抖动；创作/源变化清卡，换范围关闭，晚回包不采用。此本地显示 key 不是主进程的语义指纹或执行授权。
5. 保存失败零 suggest RPC，退出仍通过原队列报告真实 failed；原外部未确认写入仍走既有 pending 核对入口。本批传输/无库/不支持/无匹配/无效回复均有限结束，可显式刷新。关闭只停止采用旧回复，不冒称终止主进程任务。

## 实际验证

- 新 actions：17 项，使用真实持久队列，覆盖完整 raw（含 upgrade 会丢弃的 assemblyUrl）、精度保留、预检失败零 RPC、pending 读取/review 时 `flushAll=saved`、有限元数据重读、创作/选版/工程/页面失效，以及空/上限/无库/无效/传输失败重读。
- 真实 Pro：13 项，从实际剪辑入口到对话框，验证全段和 notes、原 takes/audioClips 保留、零 add/provider、保存失败和 quit 回执、pending 关闭/换页/实际作品菜单切换、内容变化清卡与显式刷新。创作/选版异步变化通过实际 editor host 注入，不假称模态遮罩后用户可点穿修改。
- 纯显示 5 项、原 next/rules 7 项；原手动库/退出/保存/历史/画面字段/外部写入队列 7 文件 69 项回归。原导入原文跨页/迟到导入与音乐导入三项定向回归通过（同文件其余 138 项未选，不算本轮重跑）。
- 正式 web `typecheck`（`tsc -b`）、`build`、目标 ESLint/Prettier 和 diff 检查。未运行覆盖率全量、付费调用、真实素材试听或 Electron 全链路；正常沙箱 Chrome 新建议页门待后续独立批次，不能用 jsdom 宣称像素布局通过。

日志：`/tmp/shot-audio-suggestions-targets-final.log`、`/tmp/shot-audio-suggestions-regression.log`、`/tmp/shot-audio-suggestions-import-regression.log`、`/tmp/shot-audio-suggestions-build.log`、`/tmp/shot-audio-suggestions-lint.log`。日志仅本次工作环境存在。
