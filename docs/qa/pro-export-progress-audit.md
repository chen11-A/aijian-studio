# Pro 导出进度与停止请求浏览器门

从真实 ProWorkspace「导出成片」→「检查成片」进入，复用合成工程、有效小视频和克隆读写伪桥。独立的进度事件、操作 ID、取消 ACK 及可控 promise 驱动真实宿主与 ExportProgress；不挂载组件故事页，不启动或停止真实 FFmpeg/PID，不生成/发布真实文件，不调用会员或付费接口。真实进程退出与媒体处理需由后端实际子进程测试补充。

```sh
node apps/studio-web/e2e/pro-export-progress-audit.mjs \
  --browser /usr/bin/google-chrome \
  --out .aijian-dev/pro-export-progress
```

新入口是薄封装，复用 `pro-export-qc-audit.mjs` 导出的 `runAuditCli`。直接执行原 QC 入口仍运行原来的 32 态、输出约束和退出码；导入共享模块不会启动测试。默认启动并关闭随机 loopback Vite/HTTP 服务，也可传本地 `--url`。支持既有 `AIVORA_CHROMIUM`、`AIVORA_AUDIT_URL`、`AIVORA_AUDIT_OUT`，只允许临时或仓库忽略目录输出，不递归删除用户目录。Chromium 沙箱始终启用，外部 HTTP 与 `/api` 全阻断且记失败。

## 8 态 × 4 组合

1280×800、1920×1080 × 16:9、9:16，各态独立浏览器上下文。先断言真实导出和进度标题到达、只有一个可提交主动作，再测试事件/按钮并检查 dialog 几何，不把页面到达当成布局通过。

| 状态              | 检查内容                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| measured-units    | 真实事件的当前阶段 2/3 个镜头，原生进度条值与总量一致，不推整体百分比                                             |
| measured-time     | FFmpeg 形式的真实秒数 7.5/30 显示「本阶段 25%」                                                                   |
| unknown           | 无测量及非法 NaN 测量均保持不确定，没有伪百分比或 ETA                                                             |
| requested         | 用户请求后 ACK.snapshot 进入 requested；重复 DOM click 不重发，也不显示已停止                                     |
| stopped           | requested 后，另发明确 stopped 事件才显示「处理已停止」，移除进度与停止按钮                                       |
| unavailable-retry | UNAVAILABLE ACK 明确未接受，当前步骤不可停止；下一阶段 available 后允许再次请求，同 operation 不换 ID             |
| stale-events      | 同序/旧序、旧 operation、错工程事件不覆盖真实数值；更改清晰度后停止旧操作并拒绝旧事件/迟到 READY，不能发布        |
| partial-playable  | 审核后发布使用新 operation；保留已发布画幅，主机确认停止后返回 PARTIAL；生产「播放」按钮调用保留文件的伪 open spy |

取消 ACK.snapshot 与独立 feed 使用相同单调序号门；伪桥的取消 ACK 不额外广播，直接验证宿主消费 snapshot 的路径。REQUESTED 只确认请求，不代表进程已退出。已接受请求不会因任意时间推移自行变 stopped。回执、操作 ID、原始路径不作为组件文案；已发布标签经真实 adapter 安全投影，恶意路径/凭据标签不能出现在组件中。

部分发布的播放检查只证明真实按钮派发了保留文件的打开动作；不会启动系统播放器，不能写成媒体已经播放/听过或 Electron 文件打开已验。长报告仍由原 QC32 门覆盖，进度组件的特殊长标签/非法值另有组件测试。

## 证据与退出

每态输出 `progress.png` 及 `report.json` 中的导航、控件、几何、调用、事件序号、失败。记录提交/工作树状态及固定源文件 SHA256；progress 额外包含 ExportProgress、CSS 和宿主进度 adapter，契约 DTO 与真实宿主也在固定列表内，不开放任意源路径 CLI 参数。失败仍尝试截图/几何，其余态继续。GitHub 最多八条安全注释，只含白名单状态/组合/kind/数值，不复制原始错误或凭据。

退出 0 需要完整 32 态通过；1 是交互/导航/几何回归；2 是参数/浏览器/服务/清理错误。普通 Ubuntu pro-layout job 保留 core24/full60/url24/QC32，再独立调用本门，前一步失败也继续并保留 job 失败；只上传明确 report/两窗口 PNG，允许隐藏目录、保留七天，不上传缓存、不改 quality 矩阵。

本机仅完成静态/格式、共享模块无启动副作用、QC/progress 六项负向与十六合成夹具组合检查。缺浏览器的两入口均 exit 2、零正向结果、临时 HTTP 端口确认关闭；证据位于 `.aijian-dev/pro-export-progress-negative/negative-results.json`。合成夹具检查使用真实 `acceptExportProgress` 核对事件/ACK 的序号及 READY 返回。本机无可用沙箱，32 态正向与原140态在新源码上的回归仍待普通 Ubuntu CI；不得复用其他提交的绿灯或把伪事件当实际 PID 停止。
