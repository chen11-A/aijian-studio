# 真实 Pro 导出审核浏览器检查

从生产 ProWorkspace 的「导出成片」→「检查成片」进入审核，使用合成工程、仓库小视频及明确的伪 QC 桥；不单独挂载 ExportCheck，不运行 FFmpeg、不生成视频、不写真实导出文件，不调用会员或付费服务。这是宿主交互与布局门，不是 Electron 全链路、真实质量检测或真人观看/试听验收。

## 复跑

```sh
node apps/studio-web/e2e/pro-export-qc-audit.mjs \
  --browser /usr/bin/google-chrome \
  --out .aijian-dev/pro-export-qc
```

默认在 Node 内启动并最终关闭随机 loopback HTTP/Vite 服务。可传 `--url http://127.0.0.1:5173/` 复用已有 Vite。支持 `AIVORA_CHROMIUM`、`AIVORA_AUDIT_URL`、`AIVORA_AUDIT_OUT`；命令行优先。输出只能位于系统临时目录或本仓库 `.aijian-dev`，解析实际路径防止符号链接绕过；不递归删除用户指定目录。

始终使用 Chromium 自身沙箱；外部 HTTP 和 `/api` 请求全部阻断且作为失败记录。浏览器不能启动时 exit 2，不自动关闭沙箱。退出码：0 全部预期状态通过；1 导航、交互或几何失败；2 参数/服务/浏览器/清理失败。

## 32 个独立状态

1280×800、1920×1080 × 16:9、9:16，每组合分别新建上下文运行以下八态：

| 状态         | 真实宿主断言                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- |
| clean        | 合成无问题报告、人工未验说明、仅一个审核主动作；用户取消后 discard，零 publish                |
| warn-long    | 18 条警告，末项与页尾按钮滚动可达、长报告真实滚动区；只有点击「审核后发布」才调用一次 publish |
| block        | 当前报告 block 禁止发布，取消仍可用                                                           |
| other-block  | 导出选「两种都要」；当前画幅无问题也被另一画幅 block 拦住，切换后仍禁止发布                   |
| failed       | prepare 返回固定 CHECK_FAILED；显示中文失败及禁发布，允许取消审核                             |
| stale        | READY 后改清晰度；显示结果过期、禁止发布、丢弃旧 receipt，仍可取消                            |
| prepare-busy | prepare promise 暂不返回；检查中发布/取消禁用，无第二个检查主按钮                             |
| publish-busy | 用户发布后 promise 暂不返回；发布/取消均禁用，重复 DOM click 不增加调用                       |

所有报告通过当前 `readQcReport` 的 schemaVersion 1 校验。伪桥提供工程目录列表及按 ID 克隆读写的完整工程，准备前宿主可以真实等待保存和回读最新快照；没有“永远返回初始工程”的假保存。报告 READY 返回的是合成 opaque receipt，不提供真实媒体输出。发布 spy 返回 CANCELLED，不写成片；它不能证明真实文件发布成功。

准备请求严格只有 projectId、expectedSelection 和 settings，选中 take IDs 必须与工程一致；发布调用只增加 qcReceipt。禁止调用旧 exportFilmCut、生成、拼接、补做或目录选择。准备不会自动发布，取消/陈旧结果会 discard；业务规则仍由真实宿主处理。

## 布局、证据与边界

进入真实审核后记录 reached，检查仅有一个可见主按钮，再验证交互和几何；到达不等于布局通过。复用 core/full 的几何探针，范围是当前导出 dialog，检查控件裁切、中心遮挡、按钮内容与文档溢出。允许真实滚动面板中的屏外内容，但关键控件必须用 trial 点击证明可滚动到达；禁用按钮仍需滚动至页尾并接受几何检查。没有隐藏或跳过失败项。

`report.json` 记录实际源码提交、工作树是否有改动、ProWorkspace/样式/ExportCheck/契约 SHA256、媒体 fixture SHA256、窗口/画幅、每态导航、几何、伪桥调用和失败。逐态保存 `review.png`；长报告额外保存 `report-tail.png`。失败也尽量保留截图和几何，各态独立继续。GitHub 注释最多八条，只含白名单状态、组合、问题 kind 和数值，不复制原始错误或报告。

普通 Ubuntu 的现有 pro-layout job 保留 core 24、full 60、受控 `--url` core 24，再独立调用本门。只上传各自明确的 report/两窗口 PNG，7 天保留、允许隐藏目录，不上传缓存或整个工作区；原 quality 矩阵不变。本批 full 的导出主按钮定位由旧「导出」更新为实际「检查成片」，仍只 trial，不发起检查；未删除导出态或复用旧分支的结果。

本机已完成语法、ESLint/格式、三项负向（外部 URL、产品目录输出、缺浏览器）检查；缺浏览器后临时 HTTP 端口确认关闭，负向证据在 `.aijian-dev/pro-export-qc-negative/negative-results.json`。另以真实解析器验证 16 个画幅/状态合成案例及存盘克隆隔离。本机因无可用浏览器沙箱，32 态正向尚未运行；必须读取后续普通 Ubuntu CI 的实际 report，不能把脚本存在、负向通过或后端 FFmpeg 单测写成浏览器/真实 Electron 已通过。
