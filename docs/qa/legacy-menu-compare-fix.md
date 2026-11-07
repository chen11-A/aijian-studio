# 人物引用菜单与局部范围走查修正

本片基于 `886f496`，对应正常 Chrome `42370553019 / 128397607191` 的两组公开失败。公开注释最多八条，不据此推断其余组合已通过；没有下载或目视检查截图。

## 人物引用菜单

真实诊断显示菜单为 absolute、top 40、left 0，菜单可见高度约 10px，且元素中心命中自身但完整按钮被裁切。完整生产 CSS 的受控计算同样得到 top=40px、left=0px、bottom=30px：后置通用 `.menu` 覆盖了原引用菜单的 auto 值。仅提高 `.menu.mention-menu` 专属选择器的优先级，保留向上展开、240px 上限及菜单自身滚动；计算后 top/left 为 auto。未修改通用菜单、几何探针、可见比例或点击规则。计算样式不是正常浏览器像素验收，修后实际可达性仍需新的正常沙箱 Chrome 验证。

## 局部入出点

真实 Pro 的“设入点”同时开启范围和版本对比，原 `.preview-player video.frame` 被卸载；比较视图显示当前镜头的三个真实版本。原脚本第二次拖动后仍等待已卸载播放器的 metadata，故视频数量为零。

脚本仍使用原鼠标轨迹拖动实际 ruler。比较期间核对真实比较视图、三个源及实际 ruler 出点；随后点击“关掉对比”，对恢复的真实播放器发送受控 DOM metadata，并核对请求的实际秒数；点击“取消选择”恢复标记工具栏，再点击真实“设出点”。这些操作不清除已记录入点。原局部表单的精确入出点、完整媒体、一次组装和零付费提交断言保留。没有写 React state、伪造 currentTime/readyState/getter 或修改产品播放器。

## 受控证据与边界

- 完整 CSS 计算 before 非零退出：`/tmp/legacy-mention-cascade-before.log`；after 为 auto：`/tmp/legacy-mention-cascade-after.log`。
- 同一真实 Pro 生命周期继续要求旧 monitor 存在会失败：`/tmp/legacy-compare-consumer-before.log`；永久宿主回归验证比较/恢复路径、实际 1–2 秒范围和媒体不变。
- 原 assembly 11、原 range 5、actual-Pro e2e 5，联合 **21 项通过**：`/tmp/legacy-menu-compare-host-joint.log`。
- 原十二个 Node 契约文件 **123 项通过**：`/tmp/legacy-menu-compare-all-contracts.log`。
- 工作流与本片基线字节一致，所有原状态、次数、沙箱和安全注释规则保留。本机受控 DOM 事件不代表真实解码、播放、试听或文件交付；新正常 Chrome 32 态尚待 root 推送确认。
