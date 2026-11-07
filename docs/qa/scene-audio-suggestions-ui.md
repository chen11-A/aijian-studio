# 整场声音建议：查看、明确选用与整组核对

本片接冻结 native `312d6d2`，只扩 Pro 剪辑页的整场界面。原单镜建议与单素材添加保持独立；没有新增生成、供应商、自动付费或自动选用。

- 入口“查看本场声音建议”按工程／页面／场次绑定。同场浏览另一镜不改变该场 scope。请求包含全片实际已选镜头的完整有序选择，不拿本场子集或 `shot.seconds` 代替 native 时钟。
- 对完整回包核对全部时钟行、场次连续性、每段镜头／版本／位置／素材与包络、全部提醒和限制。三轨逐段展示名称、来源许可、实际镜头时钟、镜内与全片计划位置、源偏移及淡入淡出／音量变化。人读数值至多四位小数，缓存与后续验证始终使用原精度。
- 查看只短暂保存当前稿并读取 raw hash，RPC 与人工审阅不占保存 owner。仅能证明是 `savedAt/directory` 漂移时最多重读一次；创作、选择或来源变化不能套此例外。没有同工程升级后 `apply` 循环来刷新保存时间。
- 默认不勾轨道；明确选完整 lane 子集后只调用一次新 scene apply，不循环旧 add。接收 ADDED 与丢 ACK 后的读回均验证全 raw 非音频字段、旧片段原顺序、全部新增段的多重集合、全局唯一 ID、逐成员与全组摘要；不能凭 binding、组名或部分成员宣布成功。
- 显示／移除先验全工程组，再按当前场次展示，跨镜成员不会被当前镜过滤掉。移除只删完整组的精确引用并保留文件。完整可移除与当前能否混入声音是两回事：native 的 stale 组提醒单列，并与 WebAudio 解码／容量失败说明同时显示，不把静音说成试听成功。
- unknown 先进入原全局待核对队列，再判断旧对话框是否已离开；BUSY 不重发 apply。实际 factory 结束后才读 fresh canonical。普通晚编辑可安全追加完整组；删除参与镜头等冲突保留两份，只有用户明确选择并重新证明 fresh saved 后才放弃原稿。最后同步 apply／confirm 与原 quit 保护继续共用既有队列。

受控回归覆盖实际 Pro 入口、默认零选用、跨镜完整加入和移除、未保存前置零 RPC、部分组不成功、BUSY→完成、只读审阅不挡保存、仅保存时间漂移的有界重读、缺库与空计划、创作旧回复丢弃、跨作品迟到全局登记／原稿安全合并、外作品完整 raw 与正确完成 checkpoint 后零额外写、非首镜删除冲突的显式采用、全局 ID 碰撞及两种 hash 微任务间隙。原单素材、单镜组、历史、退出、画面字段与拆镜测试联合复验。

这些 renderer 测试使用合成 ABI、内存 canonical 和真实 renderer 保存队列，不声称实际复制、试听、文件 SHA 或 Electron 全链路验收；后者由冻结 native 的文件／FFmpeg 回归互补。整场新增正常沙箱 Chrome 门后置独立批次，不能把本片组件存在或 jsdom 通过写成像素验收。无文件系统实时监听；相同路径外部改字节仍须 native 在刷新／明确选用时重新核验，缓存键不是执行授权。

本片验证日志：`/tmp/scene-audio-ui-joint-final.log` 为新旧十六文件一百七十七项通过；`/tmp/scene-audio-new-final.log` 为本片三文件十七项通过，包含实际 Pro 十二项及两种微任务保护。最后缓存键断言单独复验三项见 `/tmp/scene-audio-proof-final.log`。正式 `typecheck`（`tsc -b`）、生产构建和目标 ESLint／Prettier／diff 检查均通过，分别记录在 `/tmp/scene-audio-types-final.log`、`/tmp/scene-audio-build-final.log`、`/tmp/scene-audio-ui-eslint-final.log`、`/tmp/scene-audio-ui-prettier-final.log`；这些子集不相加当作全量测试。
