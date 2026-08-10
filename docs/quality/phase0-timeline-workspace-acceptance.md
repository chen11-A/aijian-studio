# Phase 0 基础时间线工作台验收记录

状态：PASS（UI01 基础时间线子项；UI01 整体仍需统一 `web-e2e-skeleton`）

对应规格：[基础时间线工作台](../specs/phase0-timeline-workspace.md)

## 已证明

- 项目时间线通过通用 Artifact 账本持久化；首版 revision 为 1，trim、reorder、replace
  每次追加一个不可变版本，重启 API 后仍能读取。
- API 通过项目作用域读取，陈旧 revision、重复创建、越界、无变化和未知项目均确定性失败，
  不会部分写入。请求和响应不包含媒体路径、SQLite 路径、Provider 凭据或 Sidecar token。
- OpenAPI 生成类型已经接入 Web transport、Electron preload、IPC 和 main 进程客户端；main
  对 ID、hash、timebase、帧范围、引用完整性和总时长进行运行时校验。
- “剪辑台”已经进入一级导航，包含真实加载/空/错误/保存中状态、版本/画幅/帧率/时长摘要、
  监视器、Clip 检查器和横向时间线；支持键盘可达的选择、裁剪、前后移动和素材替换。
- Web Playwright 通过真实 API 将 `clip-letter` 从 12/36 帧裁剪到 16/30 帧，页面从 REV 1
  更新到 REV 2，总时长从 156 帧更新为 150 帧；网络请求为 200，控制台 0 error / 0 warning。
- Electron Playwright 通过 preload → IPC → main → 随机端口 Sidecar 读取首版并执行同一裁剪，
  再读数据库确认 revision 2、源入点 16、持续 30。Renderer 中 `process` 和 `require` 均为
  `undefined`，整页无横向溢出，控制台无 error / warning。
- Electron E2E 数据目录现仅能在未打包开发版中显式覆盖，且必须是仓库 `.aijian-dev`
  的子目录；测试不再复用日常开发工作区。

## 响应式实测

| 视口     | 结果                                                               |
| -------- | ------------------------------------------------------------------ |
| 1440×920 | 双栏监视器/检查器、项目轨和完整时间线同时可见                      |
| 1024×768 | 顶部横向导航，监视器与检查器纵向排列                               |
| 768×900  | 单列工作区，无整页横向溢出                                         |
| 320×800  | `pageWidth == clientWidth`；仅导航和 Clip 轨道在自身容器内横向滚动 |

首次 320px 检查发现根节点 `min-width: 320px` 与垂直滚动条组合产生 15px 整页溢出；
移除根级最小宽度后，时间线页 `pageWidth == clientWidth == 305`（滚动条占用 15px），
内部导航和 Clip 轨仍可独立滚动。

## 自动化结果

- Python：523 项通过；行覆盖率 94.44%，分支覆盖率 83.99%。
- Studio Web：62 项通过；总行覆盖率 94.94%，函数覆盖率 90.37%。
- Desktop：58 项通过；总行覆盖率 95.42%，函数覆盖率 99.18%。
- `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。

## 证据

- [Electron 结果](evidence/timeline-electron-smoke.json)
- [Electron 1440×920](evidence/timeline-electron-1440x920.png)
- [Web 1440×920](evidence/timeline-web-1440x920.png)
- [Web 1024×768](evidence/timeline-web-1024x768.png)
- [Web 768×900](evidence/timeline-web-768x900.png)
- [Web 320×800](evidence/timeline-web-320x800.png)

以上文件由 `evidence/SHA256SUMS` 绑定。

## 尚未证明

- UI01 的统一 `web-e2e-skeleton` 还没有在一次自动化运行中串联“创建项目 → 导入 TXT →
  任务队列 → 时间线编辑”；因此本记录只关闭基础时间线子项，不把 UI01 整项标记完成。
- K01 尚未让 Fake 工作流自动建立时间线并从 UI/API 导出 MP4；本次时间线由隔离验收夹具建立。
- 不证明多轨、字幕、转场、调色、混音、撤销栈、真实 Provider 或影片团队审片通过。
