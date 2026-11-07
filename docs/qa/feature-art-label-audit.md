# 完整美术字段卡：浏览器旧标签定位修正

公开 CI `42351229042` 的 layout job `128339599028` 最多显示的 8 条失败注释均为 `art-style-preview`／`art-style-confirm`，`checkLine=238`、`reached=0`。该行先前等待精确标签「画风说明」，真实新完整美术字段卡已改为「全项目 · 画风说明」。此前的 1 字段和 1 行计数已经越过；没有匿名读取截图，也不由注释上限推断未显示状态的结果。

本片基于 `3bfb4f5`，只把该定位改成生产的精确新标签，并等待真实全项目范围说明。保留完整 feature 6 态 × 4 组合（含最初 art／wave 16 态及 history 8 态）、原字段值、确认前零新画风保存、原媒体／版本、确认一次文本请求、所有控件试点击、长字段边界及确认前后几何断言；不改产品、fixture、workflow、阈值或状态数量。确认后没有旧 note／notice／undo 文本查询需要替换，因此不额外改写这些流程。

本机仅运行既有 Node contracts、Node 语法、目标 ESLint／Prettier、workflow 完整字节对照及 diff 检查，日志 `/tmp/feature-art-label-{contracts,static,workflow}-final.log`。正常 Chrome 仍由总控推送后重验，不把静态检查写成浏览器通过。
