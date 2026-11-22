# 七段视频事实整理：范围与回归

入口为真实 Pro 分镜属性「高级」及单镜/剪辑助手旁的「整理视频说明」。本机按当前文字设定整理风格、镜头、布局、身份、动作、声音、约束；没有新增模型调用，不观看像素、不验证动作或口型。未知说明为待决定，须回到已有属性编辑后重新整理。

## 实际提交与确认

- 使用 `FilmShot.reviewedVideoPrompt = {schemaVersion:1,text,factsKey}` 独立字段；不替换静帧 `promptZh/En`、导演原稿或用户锁。事实展示、单项字段改动与完整请求说明分开。重复整理无差异时显示零改动。
- 通过既有 editorHost 的固定请求基线、字段事务、保存和顶栏撤销；确认前工程不变，不派发媒体。迟到媒体保留；输入、页签、工程或选版变化拒绝旧确认。保存失败保留「已应用但尚未保存」的真实状态。
- 实际请求仍为 `storyFilmBatches → oneShot → motionPrompt`。有已确认稿时同时核对创作绑定和完整编译文本，不借一个 key 信任被替换的 body；无新稿的旧顺序保持。过期稿明确要求重新整理，不能默默退回旧文字。
- 只从本镜已选择且可见的人物取身份和有效服装；复用场景关联、服装作用域及现有动作/表演投影。空人物选择不展开整个库。场景图片、波形、普通保存等非创作到达不使稿件失效。
- 当前整型请求时长为 1–15 秒，真实完整 `prompt` 上限 2000 字符，沿原校验拒绝过长稿并提示精简/拆镜，不静默裁切。没有把静帧代理的 90 词约定加成供应商硬限制，也不把旧模型带图 10 秒规则套给当前 full/lite。
- 当前视频服务明确关闭原生声音；声音段只供独立配音与后期核对。原始 `lines`、对白与 TTS 字段保留；不把台词、环境音和配乐设想改写为原生音频请求。

## v1.1：单镜本地 SKILL.md 参考

入口仍为分镜属性「高级」或单镜/剪辑助手的整理视频说明区域，展开「导入本地 SKILL.md 参考」。一次只读一个不超过 64 KB 的 `.md`/`.markdown` 文件；原文仅作为只读纯文本展示，不渲染 HTML、不访问链接、不执行脚本。不会自动采用全文或解析其工具权限。用户主动选择片段点「采用选中文字」（仅填入编辑框）或自行写入不超过 2000 字符的「本镜构图指导」，再点「预览本镜构图指导」，核对七段事实和完整提交文本，最后点原「确认视频说明」。

确认通过原字段事务同时保存本镜 `videoFramingGuidance` 编译输入与重新编译的 `reviewedVideoPrompt`；下次整理/重开工程仍从事实重编，不修改缓存文本冒充编译。原文、文件路径和未选内容不进入视频请求。指导只进入视觉镜头段，不改台词、TTS 声音、音频片段、所选 take、ID 或媒体，也不影响相邻镜头；不创建任务、不请求供应商或预算。确认前不改工程，顶部「撤销」恢复两个字段并保留原音频/媒体。替换文件或编辑指导会关闭旧预览，事实、选版、页面或作品变化继续拒绝旧确认。完整请求超长仍由原 2000 字符检查拒绝，不截短提交。

复跑下方测试并加入 `ProWorkspace.audio-mix.test.tsx`；宿主用非空对白、声音选择、已选视频、现有音频与相邻镜头验证真实预览/确认/保存/撤销路径。纯测试覆盖重开升级与过期拒绝。这些测试不证明 Windows 安装包或真实供应商输出。

## 两种临时投影

尚无已选或可用视频、仅有无输出的失败/取消遗留版本时，队列自动选择本批首个新 take；先核原完整稿、全部创作事实与新 take 身份，再仅为本次请求重编。编译文本必须仍等于原确认文本。已有可用旧视频、用户另选或实际输入改变不能借此例外通过；不重写存档 key。

秒级局部重做先核存档整镜稿，再编译本次局部时长、无新对白的独立临时范围。既有确认框显示本次实际提交说明，仍只显式派发一次并保留原音轨/历史。局部检查不清除或重新绑定存档中的整镜稿。

## 工程包与边界

工程包保留创作说明 `text`，清空 `factsKey`，避免账号声音绑定及旧作品身份藏在序列化字符串内迁移。导入后的新作品须重新整理、确认，旧文本本身不构成权限或媒体来源证明。

目前 key 使用完整创作输入的规范序列化，并包含原始剧本以保护输入变化。它是内部缓存绑定，不能当授权，也不进入显示 props 或模型 prompt；长篇原文会增加每个已确认镜头的存档体积。此次没有另造摘要算法或引入依赖。真实供应商输出、Electron 实机与全页几何验收不由这些合成 IPC/宿主测试替代。

## 复跑

```sh
pnpm --filter @aijian/studio-web exec vitest run src/aivora/film/seven-part-video.test.ts src/aivora/pro/ProWorkspace.video-review.test.tsx src/aivora/pro/ProWorkspace.range-redo.test.tsx src/aivora/pro/actions/generation-run.video-review.test.ts src/aivora/pro/actions/generation-run.test.ts src/aivora/pro/ProWorkspace.prompt-fields.test.tsx
pnpm --filter @aijian/desktop exec vitest run src/film-project-archive.test.ts src/film-project-archive-preload.test.ts src/film-project-archive-runtime.test.ts
pnpm --filter @aijian/studio-web typecheck
```

宿主回归从真实入口确认，再点击原生成按钮，检查实际 `createStoryFilm` 的 payload；覆盖媒体/版本保留、保存失败、重复确认锁、切页/切作品迟到保护及顶栏撤销。range 宿主检查真实 `generateFilmRange` 参数与原音轨范围。native 工程包使用真实 ZIP/新库往返；所有供应商与媒体 IPC 均为替身，无付费调用。
