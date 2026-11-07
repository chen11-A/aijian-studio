# 验收：实际试片与初始恢复的保存边界

独立树 `/workspace/aivora-acceptance-trial-save-boundary`，基50a6a3e；没有改正在验收的原目录，也未合939b4c9 auto-source检查点。

## 已知真实失败

旧de2 CI run42415135411 / Windows job128531463799 的 checkpoint=true 用例在 review 等时长失败；实际 dialog aria-busy=false，并显示“当前编辑还没保存上，请先核对保存状态，再准备试片。”。该文案既能由 acquire 失败产生，也能由真实写入/receipt预查失败产生，不能仅凭它归因为 Windows FS。

源码中持久pipeline会在mount effect调用真实 recover，占用同一persistence owner。旧测试只等当时 recoveries Set 的内容且忽略 flushAll.status；在预期初始recover尚未启动时，空Set不能证明终态。原writeProject走同root队列/唯一临时文件，没有据此确认Windows并发写损坏。

正常Linux纯观察 `/tmp/acceptance-trial-safe-lifecycle.json` 得到 recover→owner→label可见→真实save receipt→release→recover完成→flush saved→审核另一次owner/save/release。本次不冒称本地重现了Windows原调度。

## 受控因果与最小修复

永久actual Pro负例只hold**这次真实初始recover的一次write Promise**，仍是原persistence owner/原FS写入。该例明确观察pending阶段（不让普通ready helper先等待），真实点击剪辑和审核，取得同一save alert、busy=false、native prepare/record/provider均0。关窗后释放真实write并等恢复终态，再由用户重新打开审核，素材可读且恰一次prepare/mediaRead；没有自动retry save。

`/tmp/acceptance-trial-save-controlled-cause-final.log`：上述机制目标1通过/8未选。前两次受控尝试 `/tmp/acceptance-trial-save-controlled-{cause,second}.log` 因外层初始化act尚未结束阻住所要观测的UI提交而失败，保留，没有改超时。

默认helper在 checkpoint=true 时现在显式等预期首次recover**被实际调用并终态完成**，再等其它已开始操作并断flushAll.status=saved。延迟effect不再被空Set当完成。所有原准备/人工决定/继续/媒体与0provider断言保留；不改生产文件、不吞保存错误、不重试、不加timeout。

## 结果与局限

- `/tmp/acceptance-trial-save-file-final.log`：整文件9项 / 5.28秒通过，exit0，含原8项与新增机制反例。
- `/tmp/acceptance-trial-save-types-final.log`：正式web类型；`...-eslint-final.log`、`...-prettier-final.log`：owned静态/格式，diff0。
- 只跑必要目标，没有原完整web。受控owner机制与Windows原FS因果分开；新Windows/原完整门由root验收，不提前宣称远端已修复。

临时observer diff `/tmp/acceptance-trial-save-observer.patch` 与其日志保留；临时trace/console/JSON导出没有进入提交。没有扩大生成或恢复能力。
