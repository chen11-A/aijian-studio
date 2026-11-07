# 声音组跨作品恢复：完整存档基线

核对基线：`c944dc2a2ccfbd5d1baa82edcd9f2caada4ff86e`。

完整 renderer 门唯一失败在 `ProWorkspace.audio-suggestion-groups.test.tsx` 的跨作品安全合并用例：恢复原作品成功、当前作品未被替换，但另一集完整 raw 对比出现正常初始化的 `continuity.missing_look`。此前在当前作品 ID 改变后立即取存档基线，尚未等这次打开触发的正常保存完成。

使用真实 `createFilmPersistence` 队列，受控暂停另一集首个实际 native write：在完成前取基线可复现相同差异；等待实际 write 准入并释放、再等待这次 save 完成后取完整 raw 基线，用例通过。没有过滤 `continuity`、`savedAt` 或其他字段；新增断言要求原作品恢复期间另一集 write 次数保持不变。原作品新稿、完整声音组、一次选用和当前作品不变的断言全部保留。没有改产品守卫、等待上限或保存行为。

验证日志：

- `/tmp/group-foreign-rebase-diagnosis-controlled-before.log`：受控旧取基线顺序，1 项失败，复现完整 raw 差异。
- `/tmp/group-foreign-rebase-diagnosis-controlled-after.log`：受控正确保存完成顺序，1 项通过。
- `/tmp/group-foreign-rebase-diagnosis-joint.log`：5 文件 49 项通过，包含声音组 19、原单素材 19、两类微任务守卫及外部写入队列。

这次修正是测试同步，不是正常 Chrome、真实音频试听或完整 renderer 覆盖率门的通过证据；完整门由集成分支另跑。
