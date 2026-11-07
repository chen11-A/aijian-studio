# 长人物菜单与标尺拖动：受限几何取证

source 2a173 / run 42368883836 的新 32 态仍失败，公开八条为两 state 的四个窗口/画幅组合：cast 在额外完整可达性断言，timeline 在拖动后交付 metadata 的 video.evaluate。公开上限不能证明其余组合已过。恢复 16 与 scene 16 本轮正向各自记录，不抹去旧失败。

本片不改产品/CSS、原鼠标轨迹、播放器 getter/currentTime/duration、滚动/完整矩形比较、几何阈值或 wait。菜单实际上继承 `.menu` 的 absolute，不能凭空给 fixed 逃逸例外；目前没有真实 Chrome 矩形证明是哪一级裁切，不能猜修。

- 原 reachable 比较逐项原样抽为只读 measure；额外读取自身/可见交集/限制祖先/菜单矩形、computed position/top/left 和中心 elementFromPoint 是否命中。仍先原完整矩形 assert，再原 trial click；没有为了通过而跳过任何控件。
- 拖动按下前/抬起后只读阶段、监视器固定 tab、video 数/attached、声明 src/currentSrc 是否匹配固定 synthetic artifact、readyState/time、鼠标点与命中的 ruler/track/固定监视器 tab。没有输出 URL、地址或 DOM 正文。
- 失败时用原 probe 重新读取真正失败的当前 scope；既有历史 checkpoint 几何仍保留，不拿菜单关闭前的旧成功矩形覆盖失败。

公开注释再次固定枚举/严格 boolean/有限数字/矩形过滤，仍 max 8；未知、伪 boolean、PRIVATE/NaN/Infinity 不输出。新增 Node 契约验证原完整裁切规则（完整通过、裁切拒绝）及声明源与旧 currentSrc 分开、固定 pointer 命中投影和隐私负例。全 12 个契约文件 123/123（`/tmp/evidence-menu-range-all-contracts-final.log`），目标 ESLint/格式/Node syntax/diff 与 workflow 未改检查通过。

这只是取证工具，尚未解释两个 Chrome 故障的最终根因，也不声称修后正常 32 成功。下一正常 Chrome 的有限实际数据决定产品局部修复或测试定位修正，不把测试模拟当像素或真实播放证据。
