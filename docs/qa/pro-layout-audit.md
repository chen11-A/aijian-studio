# ProWorkspace 布局与选版核验

`apps/studio-web/e2e/pro-layout-audit.mjs` 核验真实工作台的页签与单镜版本区，不使用旧哈希页面或 `.v2-*` 演示壳。根命令 `pnpm audit:pro-layout` 与独立普通用户 Ubuntu CI job 已配置；配置存在不代表远端已通过或全产品已验收，运行结果以该次 `report.json` 为准。

## 运行

需要仓库依赖、Node 24 和可运行沙箱的 Chromium/Chrome。默认在 Node 进程内启动 Vite 中间件及 HTTP listener（127.0.0.1 实际随机端口），结束或失败都会关闭浏览器、上下文和服务器，不派生 pnpm 开发服务。

```sh
pnpm audit:pro-layout
```

也可复用已有本地 Vite，显式选择浏览器和忽略目录：

```sh
node apps/studio-web/e2e/pro-layout-audit.mjs \
  --url http://127.0.0.1:5173/ \
  --browser /usr/bin/chromium \
  --out .aijian-dev/pro-layout-audit
```

对应环境变量是 `AIVORA_AUDIT_URL`、`AIVORA_CHROMIUM`、`AIVORA_AUDIT_OUT`；命令行优先。浏览器依次尝试显式路径、系统 Chromium、系统 Google Chrome、Playwright 安装的 Chromium。始终 `chromiumSandbox: true`，不自动关闭沙箱。`--url` 只接受本地 HTTP 服务；不支持直接针对生产构建运行，因为合成工程通过 Vite 源模块载入。

默认输出到系统临时目录下 `aivora-pro-layout-audit`。自定义输出只允许系统临时目录或本仓库 `.aijian-dev` 下，避免改动产品文件。输出包括 `report.json` 与逐组合截图；`vite-cache` 是临时依赖缓存，不必作为 CI 证据上传。退出码：0 全部通过，1 导航/几何/选版回归，2 参数、浏览器或服务启动等环境错误。不会递归删除输出目录；输出路径解析后仍必须属于允许的临时/忽略目录。

## 准确范围

| 组合                                                | 实际页面/断言                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1280×800、1920×1080 × 16:9、9:16，每组合 3 版本工程 | 剧本 textarea 与 script stage、分镜 stage 与 6 卡、剪辑 stage 与预览/6 片段     |
| 同上，每组合 1/2/3 版本工程                         | 单镜真实入口、版本数量、版本区用满可用宽、数量标题不纵排、标签/按钮不越卡或视口 |

共 12 个独立浏览器上下文、24 个页面/状态截图。导航先断言真实 stage/DOM 到达，再检查控件中心遮挡、无滚动退路的裁切、文档溢出及候选卡内容边界。可滚动面板中的屏外控件会单独记录，不作为不可达裁切；不会忽略其他几何失败。

2/3 版实际点击选版按钮，同时等待 UI 选中状态和浏览器序列化存档一致，再通过库函数回读完整 takes，核对原有版本元数据及其他镜头选择未改变。等待谓词同步读取存档，避免旧 Playwright 将 async 谓词的 Promise 当作立即成功。1 版没有替换按钮，只点击当前卡并核实选中保持。

合成工程与 IPC 替身由 `pro-layout-fixture.mjs` 提供，媒体使用仓库已有 `apps/desktop/fixtures/shot-a.mp4`，报告记录 SHA256，不依赖宿主 FFmpeg 或调用生成服务。替身的补做/导出派发会被视为异常。浏览器阻断外部 HTTP 与 `/api`；出现此类尝试仍会令该次核验失败，而不是放行网络以取得通过。

## 默认 core 不涵盖

默认 core 不代表所有页面、角色/声音/字幕/设置、所有建议或错误状态、真实会员、真实 Electron、Windows 安装包、文件恢复或完整导出链路验收。也不代替原有宿主、业务、类型与其他 CI 检查。后续扩范围必须先增加明确的页面到达与交互断言，不得用旧页面截图或空壳元素推定功能成立。

## CI 与诊断

独立 `pro-layout (ubuntu)` job 使用普通 runner 的预装 Google Chrome、Node 24.15.0 和 frozen pnpm 依赖，不在 Debian root 容器中启动浏览器，不更改现有 quality 矩阵或覆盖率门槛，不创建共享缓存。仅上传明确的 `report.json` 和两种窗口组合的 PNG，允许隐藏路径、保留 7 天，不上传 `vite-cache` 或整个工作区。

GitHub 环境中失败最多发出 8 条 `::error` 注释，只包含固定诊断码、已知组合/页面、白名单问题种类及数值；原始错误、控件文字和完整报告留在 artifact，不拼入公开注释。参数/启动失败发出安全环境码。

本轮本机正向浏览器复验因 UID 映射导致 Chromium 无可用沙箱而退出 2；静态、组件及 negative 检查不能冒充本机默认或 `--url` 的 24 状态通过。总控已将正向验收移到上述普通用户 Ubuntu CI；后续必须读取真实运行结果，不能把本机早期临时脚本或配置接入当作正式门已通过。

## 扩展范围：`--scope full`

默认 `core` 仍是上面的 24 态与完整选版存档断言。扩展范围单独运行，不替换默认门，也不包括尚未接入此分支的导出 QC 审核链路：

```sh
pnpm audit:pro-layout --scope full --out .aijian-dev/pro-layout-full
node apps/studio-web/e2e/pro-layout-url-audit.mjs --scope core --out .aijian-dev/pro-layout-url
```

第二条由独立 Node 管理 Vite HTTP listener 的真实随机 loopback 端口，再启动 Node 子进程实际传入 `--url`；结束后关闭子进程、HTTP 与 Vite，仅清理自行创建的临时缓存，不删除用户指定输出。也可继续手动传入已有 `--url`。

full 每个窗口/画幅组合有 15 个独立上下文，共 60 态：

| 状态名                                 | 真实到达依据与关键控件                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| home-empty                             | 无工程首页标题、空最近作品、无创作阶段 nav、新建按钮可达                                      |
| new-work                               | 首页画幅选择→新建；剧本 stage、画幅属性、场次编辑框和下一阶段入口                             |
| library-menu                           | 当前 Pro 的作品菜单、真实已保存合成作品入口及新建入口；不存在独立作品库页，不使用旧 HomePages |
| work-settings                          | 作品菜单→作品设置 dialog、作品名输入、保存名字按钮                                            |
| app-settings / app-settings-bottom     | 账号菜单→设置 dialog；声音开关与滚动后的底部关闭分别截图                                      |
| cast-people / cast-places / cast-props | 角色阶段与角色/场景/道具子页；实际人物名字、场景名字、第一个道具名字编辑框                    |
| edit-sound / edit-subtitles            | 剪辑 stage→monitor 子页；实际 SoundPanel/SubtitleStyle DOM、情绪/字幕样式控件                 |
| export-options / export-cover          | 真实导出 dialog 的清晰度/导出主动作；改封面后实际 CoverEditor 和返回入口                      |
| export-missing                         | 无 take 合成工程→导出 dialog；缺镜头摘要、展开列表及主动作可达；不派发导出                    |
| interrupted-work                       | 带 running take 工程重新打开；中断提示、分镜六卡、保存回读为 failed 并保留 interruptedFrom    |

页面到达和布局通过分开记录；到达后关键控件以 Playwright trial 点击验证可滚动到达且未被遮挡，不执行生成/导出。随后运行与 core 相同的几何规则；正常 dialog/menu 只检查该模态交互面（背景本应被遮罩），仍检查整份文档溢出，不忽略当前模态内的控件问题。失败也保留截图和可取得的几何结果，各态独立继续。只有全部预期状态都通过才 exit 0；“已到达 60 态”不能当成“布局零问题”。报告保留合成数据/IPC、窗口、画幅、源码提交与工作树是否有改动。

本轮本机仅完成脚本语法/ESLint/格式与负向验证：非法 scope、外部 URL、产品目录输出被拒绝；full 与受控 `--url` 在缺浏览器时均 exit 2、无正向结果，HTTP 端口退出后已关闭。负向证据位于忽略目录 `.aijian-dev/pro-layout-full-negative/negative-results.json`。云机 Chromium 无可用沙箱，未绕过；本机 core/full/`--url` 正向均未重新验成。普通 Ubuntu CI 保留 core 后，分别运行 full 与受控 `--url` core；即使前一 scope 失败，仍继续其余 scope 并上传各自明确的 report/PNG，整个 job 的失败结果保留。真实结果以实际 CI artifact 为准。

扩展仍不覆盖所有交互/异常、真实会员/生成、真实 Electron/安装包、完整视频质量或未来 QC 审核链路。发现的布局问题应按实际报告定位并另行修复，不能放宽探针取得通过。
