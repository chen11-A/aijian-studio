# 比较模式实际出点诊断

来源：`2496542 / 42372394974` 的正常 Chrome 公开失败。本片不凭未读取的报告或截图推断其他组合通过。公开两条为 1920 两画幅 `legacy-timeline-range`，已越过比较源检查，停在原 actual-clock 出点差小于 0.1 的断言。

本片仅在该断言前记录受控数字：ruler 实际读数、原 native clock 期望值、入点、该源起点和时长、clip/track-area/ruler 矩形、tracks 水平滚动、clip inline logical left/width 与 ruler max。采集和公开格式化都拒绝非数字、非有限或绝对值超过 200000 的值；时码公开最多四位小数，矩形沿原一位。未公开作品正文、DOM、ID、路径、URL、凭据或异常正文。原最多八条注释限制不变。

不修改产品、鼠标轨迹、点击、wait、metadata/currentTime、0.1 阈值、所有状态数量、付款禁止或几何规则。此诊断不代表已修复或正常浏览器已通过，下一轮正常沙箱 Chrome 数据才可区分实际时间与几何因果。试片 UI 保留在独立树，不混入本片。
