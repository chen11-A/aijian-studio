# 比较模式实际出点诊断

来源：`2496542 / 42372394974` 的正常 Chrome 公开失败。本片不凭未读取的报告或截图推断其他组合通过。公开两条为 1920 两画幅 `legacy-timeline-range`，已越过比较源检查，停在原 actual-clock 出点差小于 0.1 的断言。

本片仅在该断言前记录受控数字：ruler 实际读数、原 native clock 期望值、入点、该源起点和时长、clip/track-area/ruler 矩形、tracks 水平滚动、clip inline logical left/width 与 ruler max。采集和公开格式化都拒绝非数字、非有限或绝对值超过 200000 的值；时码公开最多四位小数，矩形沿原一位。未公开作品正文、DOM、ID、路径、URL、凭据或异常正文。原最多八条注释限制不变。

不修改产品、鼠标轨迹、点击、wait、metadata/currentTime、0.1 阈值、所有状态数量、付款禁止或几何规则。此诊断不代表已修复或正常浏览器已通过，下一轮正常沙箱 Chrome 数据才可区分实际时间与几何因果。试片 UI 保留在独立树，不混入本片。

## 第二轮事件观察

正常 `517 / 42373106030 / 128405096846` 两条公开数据为 observed=2.1、expected=3.12，源起点1.2、时长2.4；clip=(457,801,177,81)，area=(217,731,1720,316)，logical=(240,177)，pointer终点=(598.6,744)。终点几何对应目标0.8，实际差值不是一位小数读数量化误差，尚未确定拖动为何提前停止。

只在第二次实际 drag 的 mouse.down 前，为当时原 track-area 注册 capture 观察；不改默认行为。up 后两帧取快照并移除自身监听，下一次启用也先幂等移除旧监听。固定八事件：pointerdown/gotpointercapture/pointermove/pointerup/lostpointercapture/pointercancel/dragstart/dragend。记录各事件有限计数与前12条固定类型、buttons 0–7、ruler/clip/track-area/other 命中、有限坐标与当时 ruler 数值；布尔只报告原 area 是否连接、selection 是否折叠。既不读取选择文本，也不调用 preventDefault。公开计数仅0–64，其余数值保持abs<=200000/finite/number双过滤。隐私负例包含伪事件名/命中、错误布尔、PRIVATE、NaN/Infinity/超界；真实默认契约验证监听移除和0次preventDefault。
