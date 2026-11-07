# 部分发布的真实消费者提示

基线 `6f5d5ae` 原 `ExportSelectionWorkspace.integration.test.tsx` 五例受控复跑：4 过/1 败，仅部分发布用例仍要求旧通知“已有文件保留，其余没有发布”。实际 main 模拟返回 PARTIAL、首个真实路径 `/actual/first.mp4`，当前准确通知是“部分交付尚未完成，已确认写出的文件保留，请核对下方记录。”；原路径播放及工程记录均已通过。首失败日志 `/tmp/export-partial-oracle-before.log` 保留，不改产品迎合旧句。

本片只同步该既有消费者：等实际终态通知，保精确首路径播放、实际写入 exportPath、一次 publish；补核 PARTIAL 只一个输出、legacy 未提供清单且不显示生成清单、零旧 export/assemble 与 provider。没有移除旧路径/保存断言，没有更改全局门、时限或源码业务。修后原五例通过见 `/tmp/export-partial-oracle-after.log`；正式 web 类型和目标 ESLint/Prettier/diff 检查通过。仍是受控桥与 UI，不是实际成片或人工观看试听。
