# 实际版本试片：正常浏览器门

基线 `96179c4`。复用已有工作树 `/workspace/aivora-actual-risk-trial-ui` 的新分支 `codex/aivora-actual-risk-trial-browser`；原 UI 分支/SHA 保留。仅 QA、固定 profile、受控 probe 标签和独立 CI job；产品源、旧436组合、原quality矩阵/工作流前缀、几何阈值与沙箱规则不变。

## 固定四态 × 四组合

两窗口1280×800、1920×1080，两个工程画幅16:9、9:16，总16。真实 Pro 剪辑属性区 → “审核实际版本试片”，不是组件故事页；默认四桥0调用，六镜/每镜三版及原素材完整保留。

| 固定态                    | 实际交互与断言                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| trial-needs-changes       | main式prepare/media、完整长limitations可滚；默认不选、ended不记录；502 UTF-16说明完整保留且禁保存；明确需修改后原样说明单次落盘，整份raw除savedAt/唯一新增决定完全一致，无继续                                                                                   |
| trial-accepted-checkpoint | 明确接受并人工勾选才一次record；原PipelineSteps完整6镜/约需0次新增生成/会员额度说明，保存或ended均0continue；显式点击原继续后最后main式检查拒旧，精确原hash/decision检查和一次历史捕获、0provider                                                                |
| trial-unknown-global      | 默认record即建立受控待完成写入（合成ABI）并丢ACK，不能重复记录；关闭后实际作品菜单切第2集，待其实际Pro组装请求/原autosave代次/写回执结束取完整基线；global手动核对先BUSY，显式释放原native替身后fresh完整证明恢复，原作品1record、另一作品整份raw和write次数不变 |
| trial-stale-source        | 默认media promise未回；关闭后通过真实版本对比选第2版，再释放旧媒体回包，旧dialog不复活且0record；明确重开才读取新选版、显示第2版。浏览器不造不存在的路径编辑入口；同takeId换videoPath/cleanVideoPath的退休与Blob撤销已有产品实际Pro回归另证                      |

每态有页面命中、原几何检查、滚动后完整按钮可达/trial click与截图。0provider/0旧export/0旧assemble/0意外图片、视频、配音；合法本机新assemble按每次真实project/hash/selection/operationId逐条严格核对，原模式不改。仅初始一次、实际换版或换作品第二次，不能用宽松N次。已开始操作不会被当成完成；先等真实准入，再用原 `waitAssemblyIdle` 的当前作品/stage/代次、原400ms timer与实际write/native promise观察，不睡眠、不提前flush或改delay。

## 替身、沙箱与隐私边界

四桥为封闭合成ABI，返回完整curated READY、人工事实绑定和精确raw append；unknown默认模式自身就hold，不依赖测试先改mode。绑定摘要只模拟结构，非实际main授权；最后check特意固定拒旧，绝不开paid以完成流程。样本bytes仅给真实Blob/video控件载入，固定2.25秒来自合成ABI，不作为实际probe/codec/完整播放试听证据。此前实际main/文件/原queue证明由独立产品宿主和native门提供。

共用原 `runAuditCli` 的随机loopback/Vite生命周期、固定输出目录校验、Chromium sandbox=true、外部HTTP与所有/api阻断。没有no-sandbox/SUID、React state注入、currentTime/readyState伪造或跨modal强点。Node setup负向保持exit2，不当正向通过。sourceHashes固定含真实四桥合同/中立context、main/IPC、view/actions/hook/queue/checkpoint与本QA文件，不开放任意路径参数。

公开注释延续原双白名单、最多8条、固定state/control和有限几何/checkLine；不输出错误正文/stack/DOM/用户说明/路径/ID。新控件只加闭合标签，不改探针判断。独立Ubuntu job沿Node24.15与正常Chrome，始终精确上传report.json及两个窗口PNG；旧job不变。

## 本次实际结果

- 新默认ABI/CLI/隐私/negative契约11项；连原124项，十三个文件 **135/135通过**：`/tmp/actual-trial-browser-all-contracts.log`。
- 真实Pro消费这套新默认fixture，四态核心 **4/4通过**：`/tmp/actual-trial-browser-four-host-final-stage.log`。包括原文/fullraw、默认四桥0、接受不自动继续、真实原checkpoint拒旧、BUSY→settled、真实菜单切作品后另一作品fullraw/write不变与单次record，晚media不记录。测试结束先unmount/停止原autosave，再沿实际队列完成收尾，恢复本夹具替换的全局方法/timer。
- 首轮仅expected计算遗漏.length被新契约抓住并修正，旧profile/状态数未变；首lint的DOM全局已改显式window，未eslint-disable。
- 本片尚未正常Chrome运行。旧436已有root正常来源，不替代本片；只有新16全部正常通过后才可说本批452执行组合完成。实际Windows会员、main文件/codec、人工完整观看试听均不由本门证明。
