# 交付证据与既有操作：实际 Pro 浏览器专项

运行 `node apps/studio-web/e2e/pro-evidence-legacy-audit.mjs`；契约运行 `node --test apps/studio-web/e2e/pro-evidence-legacy-fixture.contract.mjs`。独立 Ubuntu 普通用户 job 使用正常 Chrome 沙箱，复用安全 CLI、已有服务器 `--url`、临时/忽略输出限制与 Vite finally 清理。不绕本机沙箱限制，不把 Node 契约当作浏览器正向。

固定 8 态 × 1280×800 / 1920×1080 × 16:9 / 9:16，共 32 个执行组合。原 388 个执行组合和 workflow 原文前缀保持；新增全部正常运行后才有 420 个组合的结果，不是 420 个独立页面。

| 状态                    | 实际入口与保留断言                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| evidence-written        | 导出成片→检查→显式发布，核对 main 返回文件名/SHA、全部文件、技术详情、选材和未验证项；目录/播放只传该次真实结果路径 |
| evidence-partial        | 首次仅列已落第一画幅；再次显式发布，完整清单加暂存清理未确认仍保留 SHA，不能称整次完成                              |
| evidence-failed-legacy  | 清单失败只列已确认文件；第二次无清单旧结果明确未提供，不拼造成功证据                                                |
| evidence-stale          | 第二次发布真实 hold，关窗切另一集，取消 ACK 不等于停止；释放旧回复后另一集完整 raw/保存次数不变，无旧结果入口       |
| legacy-board-drag-bulk  | 实际 HTML5 拖镜与 Ctrl+Z、多选批删/撤销，全部版本/画面/配音引用保留；生成确认只列所选两镜，不提交                   |
| legacy-timeline-range   | 实际缩放、看全片、聚焦标尺左右键、指针拖动和入出点，局部重做显示实际源秒数，不派发                                  |
| legacy-empty-fullscreen | 零 take 的开头画面；另一已成镜实际双击/F 全屏与 Esc、安全框可达，未注入全屏状态                                     |
| legacy-cast-search      | 12 人物真实检索/空结果/清除，选择后上下文、长引用菜单滚动可达；引用不伪装修改范围                                   |

全部从实际 ProWorkspace 交互进入，不复制 UI、不注入 React 状态或 CSS。使用原裁切/遮挡/溢出探针和阈值，检查真实当前可操作 dialog 或全屏区域，末尾控件额外滚动与 trial 点击。外部 HTTP/API 阻断，模型/生成/旧导出全部 forbidden；允许的自动本机 assembly 仍逐次核项目、完整 hash、选版及 operationId。

交付清单、QC、文件、时钟与媒体均为合成 native ABI 返回。这里只验 UI 消费/保存/入口计算，不证明 ZIP、最终文件 SHA、实际 FFmpeg、媒体解码、完整观看或听感。video DOM metadata/timeupdate 只用于已固定合成 artifact 的入口计算，不改 currentTime getter；全屏使用浏览器实际 API。main 的真实文件/探测/清理另有原 native 测试。文件存在、技术 QC 或播放请求不能证明完整观看试听。

每态记录真实到达、几何、截图、调用与固定源码指纹（新增 15 个交付相关固定源，包括 native/合同/QC 与真实展示/播放器/标尺消费者）。公开注释双白名单过滤固定状态/控件/受控类、有限数值和固定 case 行号，最多 8 条，不输出原始正文、DOM、路径或凭据。完整报告仅上传明确 report.json 与两窗口 PNG，隐藏目录允许、保留 7 天，不上传缓存。

本地检查：新契约 10 项通过，包括默认实际发布模式、部分/清理未确认、失败/legacy、第二次发布 hold、错 scope/settings/重复消费、旧媒体 seed、真实 CLI 安全负向、注释隐私负例及缺浏览器退出 2。正常 Chrome 新 32 态仍待 CI，不能由本地静态/契约或旧 388 正向替代。

最终本地旧新 11 个契约文件共 110/110 通过（`/tmp/evidence-legacy-all-contracts-final.log`），新增 10/10（`/tmp/evidence-legacy-contract-final.log`）；6 个变更 mjs 的 ESLint/Node syntax、8 个交付文件的 Prettier、diff 检查均通过。原 workflow 前缀逐字节一致，检查回执 `/tmp/evidence-legacy-source-check-final.json`。仅 QA/独立 job，无产品源码修改。
