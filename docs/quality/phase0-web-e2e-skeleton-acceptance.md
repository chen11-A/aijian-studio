# Phase 0 统一 Web/Electron 纵切验收记录

状态：PASS（UI01）；K01 仍未完成

## 验收范围

同一条自动化流程仅通过产品 UI 与公开项目 API 完成：

1. 创建项目；
2. 导入超过 2 万字的 UTF-8 TXT；
3. 启动确定性的本地 Fake 时间线工作流；
4. 查看持久化任务及其成功状态；
5. 打开三镜头时间线，执行一次帧精确裁剪；
6. 刷新或重启后重新读取项目、原文、任务和时间线版本。

测试没有预置或手工修改 SQLite，也没有调用付费 Provider。Fake 工作流明确标记为本地预览，不能冒充正式生成资产。

## 实机结果

| 运行面   | 视口                             | 结果                                                                                                                                                           |
| -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome   | 1440×900                         | 27,198 字原文；创建、导入、生成、任务读取、裁剪及刷新均成功；3 clips；全部 HTTP 200/201；控制台无错误；无整页横向溢出                                          |
| Electron | 1440×920 外窗（1409×881 客户区） | 25,098 字原文；任务 1/1 完成；3 clips；REV 1 裁剪为 REV 2；页面刷新后持久化；Renderer 无 `process`/`require`；preload 白名单精确；控制台无错误；无整页横向溢出 |

## 自动化入口

- `node scripts/e2e/browser-web-e2e-skeleton.mjs`（自建隔离数据库并启动、停止 API 与 Vite）
- `node scripts/e2e/electron-web-e2e-skeleton.mjs`
- `pnpm --filter @aijian/studio-web test`
- `pnpm --filter @aijian/desktop test`

## 证据

- [Chrome 结果](evidence/web-e2e-skeleton-browser.json)
- [Chrome 1440×900](evidence/web-e2e-skeleton-browser-1440x900.png)
- [Electron 结果](evidence/web-e2e-skeleton-electron.json)
- [Electron 1440×920](evidence/web-e2e-skeleton-electron-1440x920.png)

以上文件由 `evidence/SHA256SUMS` 绑定。

## 明确未完成

- K01 仍缺少场景规划、Fake 图片/视频/配音文件和同一流程内的 MP4 导出。
- 尚未提供 Windows 安装包，也未执行六个故障点 × 100 种子的恢复矩阵。
- 尚未完成影片团队对同一授权小说 3 镜头/15 秒成片的人工验收。
- 本切片不引入真实 GPT、xAI 或其他付费 Provider，也不改变现有 Sidecar/Web 写权限边界。

因此，本记录只把 UI01 从“部分完成”提升为“完整完成”，严格计数从 17/43 更新为 18/43；不能据此宣称 Sprint 3 或 K01 完成。
