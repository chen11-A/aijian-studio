# 真实 Pro 本地音效库浏览器门

本门从真实 Pro 剪辑页“选用本地音效/配乐”进入，不使用独立组件故事页，不注入替代 CSS。固定 4 态 × 1280×800／1920×1080 × 16:9／9:16＝16 个独立上下文。原 core24／full60／url24／QC32／progress32／features24／creation32／mix16 共 244 态及原 workflow 前缀保持不变；新源的浏览器正向仍须 CI 实际运行，不能用旧结果替代。

| 固定状态                   | 实际路径与断言                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `library-catalog`          | 实际进入剪辑页与库对话框；真实 manifest 的 206 份公开元数据（175 音效／31 配乐），检索唯一名称、选择素材、作者／许可／安全来源链接、实际 target 默认值、确认及关闭滚动可达；零 add。                         |
| `library-target-guard`     | 默认首次 target 请求真正挂起；未确认不给默认／不能加入，受控释放为来源未确认，再由用户重新核对得到 2.25 秒，不能用存档 4 秒越界；零 add。                                                                    |
| `library-add-remove`       | 真实确认一次添加、完整 canonical read/write、来源元数据与当前 take 绑定、所有原版本／定妆元数据保留；关闭后当前版本的单条“移除”，引用移除而合成文件注册表不变。                                              |
| `library-unknown-recovery` | 默认 native add 返回传输未知但生命周期仍 active，BUSY 不准重复；真实转剧本、作品菜单切另一集、全局待核对入口；写入结束后 canonical 确切冲突，通过实际审阅选择采用 saved，新作品 raw 及实际画风控件不被覆盖。 |

每态先断言实际页面和对话框到达，再检查控件遮挡、裁切、按钮内容、文档溢出及完整滚动可达；不降低旧 probe 阈值。确认主动作唯一。合法本机 assemble 受控拒绝，仍验证原六镜完整路径／所选版本、空配乐／对白输入及精确一次调用；生成、供应商、旧导出、ZIP 等额外能力仍归 forbidden，必须为空。外部 HTTP 和 `/api` 全部阻断。

## 运行与产物

```bash
pnpm install --frozen-lockfile
node --test apps/studio-web/e2e/pro-audio-library-fixture.contract.mjs
AIVORA_CHROMIUM=/usr/bin/google-chrome node apps/studio-web/e2e/pro-audio-library-audit.mjs --out .aijian-dev/pro-audio-library-audit
```

也支持既有安全 `--url`／`--browser`；默认 Node 进程内启动随机 loopback 端口 Vite，并在 finally 关闭。输出仅允许临时／忽略目录，不递归清空用户目录。正常 Chromium 自身沙箱固定开启；不使用 `--no-sandbox` 或改系统 helper。退出码 0 全部预期通过，1 审计失败，2 环境／参数失败。

`report.json` 保存固定源码 SHA256、实际次数、每态到达／几何／截图与安全行号。独立 Ubuntu 普通 runner 的 `pro-audio-library` job 先跑 Node 契约，再运行浏览器；always 上传仅明确 report 和两窗口 PNG，含隐藏文件，保留 7 天，不上传缓存。公开失败注释最多 8 条，状态／控件／标签／CSS 类双白名单与有界数字，不输出原始正文、DOM、路径、响应、凭据或 stack。

## 证据边界

目录元数据来自仓库真实 manifest；target 时钟、复制／写入、故障／BUSY、文件注册表与冲突为 synthetic native ABI。没有加载素材声音，没有声称实际试听、206 文件逐个解码、真实 Ogg 复制或 ZIP／Electron 全链路通过。真实文件字节保留与原生媒体核验由产品独立宿主／native 测试互补。

本地已跑 Node 契约与受限 CLI 负向、语法／ESLint／格式／差异检查；本机 Chrome 沙箱限制下不把环境失败记正向通过。16 态正常沙箱几何结果等待 CI。相关保存安全修 f28／后续 deferred-read 修正具有独立真实宿主证据，不能冒充本浏览器门的像素证据。

## 当前作品观察补验

run 42316677903／job 128230869345 的四个 unknown 组合已越过页脚几何门，继发失败是断言第 279 行等待 `localStorage.activeId`，不是新的遮挡证据。该库夹具为防旧工程写入抢选中，本来就不随 `writeFilmProject(other)` 改 activeId；实际 desktop `readSaved` 也不写此键，旧用例沿用 creation 夹具副作用作为当前作品依据不成立。

现通过生产主 header 的当前集名 `/ 合成第2集` 观察实际切换，并等待这一工程的真实桥写入完成及页脚保存完成后建立 raw 基线；恢复后当前 header、独有画风和完整 raw 均保持，原工程不被导航写回、恢复期间不写新工程。新增 Node 契约明确默认 native write 保存另一工程但不改变 activeId／active。没有改夹具为无条件写抢选中，也没有删除 BUSY→完成／冲突选择／一次 add／零 provider／原 takes 和几何保障；四态／16 个组合保持，正常 Chrome 正向待新 CI。
