# AIVORA phase3j 验证记录

> 历史记录：新版任务书已替换原要求，services 等范围已获授权；当前差异与状态以 [替换版任务核对](delivery.md) 为准。本文原先的“待授权”描述仅记录当时情况。

基线：`aivora-desktop-v0.3.0-phase3i` → `6efe12d411d5764277d9b1064d8bc2f83bfd0710`。
修复分支：`gpt/aivora-p3j`。只读审阅 `gpt/audit-p3i` / `f9734de083ae5c2bca73342fb64782269854f74e`，未合并审计分支。

## 输入真实性

测试小说存在：`packages/aivora-prompts/fixtures/test-novel-2000.txt`，6039 字节，SHA-256 `acaba10e8752d4730be1391682a3bbc77e6fd37308e545303dba951c28f31b9e`。内容为三场雨夜旧书店、码头仓库、医院走廊。

追加组件 `linux/AIVORA/aivora-next-components.zip` 在当前云环境 `/workspace/shared`、`/workspace/library-files`、`/mnt`、`/media` 未发现；未校验其声明的 SHA-256 / 42 文件，也未导入替代内容。只读核实 `gpt/aivora-qc` 的 `7c0eea58b218456f59d1f3ba93eddc791fdad894` 与 `gpt/aivora-media` 的样式 id；未合并这两个分支。ZIP 导入、独立署名提交、`next/README.md` 和 `qcReport.ts` 对齐等待实际文件。

## 行为与设计

- 镜头数是建议预算，超过保留全部并提示；遗漏原文补为明确来源镜头，要求核对顺序和未确认说话人，不能将此称为自动导演质量验收。
- 编剧显式段落归属必须完整、独占、合法，支持 P100 以上编号；异常响应拒绝，不用模型全文混入其他场。
- 动作只按明确 id 或原文重叠绑定；不按位置或文本镜号猜测。结构化性别年龄决定配音类别，池耗尽复用同类声音。
- 文本请求最大 100000 个 JavaScript 字符，含提示词；超限明确拒绝，完整原文不静默截断。总 deadline 包含响应头、正文、兼容重试；导演超时自动重试一次。
- 日志只落白名单元数据，原始模型响应和供应商错误正文不落盘。
- 首帧 IPC 新增可选 references 参数；可信本地图转换 data URL，HTTPS 原样传递，路径继续受媒体根目录与 realpath 约束。图片请求使用 `/images/edits` 的 `images`。
- 当前图片供应商最多 5 张参考图，超限明确报错而非静默丢弃；视频接口独立保留最多 13 张参考图和首帧。[官方图片限制](https://docs.x.ai/developers/model-capabilities/images/multi-image-editing)。未执行真实付费供应商请求或声音试听。
- 视频入口没有可用本地首帧时先执行携带定妆照的首帧生成，失败停止，避免退回不带参考图的服务端生成路径。本次没有修改 services。

## 回归证据位置

- `apps/studio-web/src/aivora/film/continuity.test.ts`：真实小说全段、台词、场尾，段落遗漏/重复/P100，预算与唯一 id，多场映射，多句对白。
- `apps/studio-web/src/aivora/film/voice-action-regression.test.ts`：动作错配、属性持久化、配音类别、HTTPS 与 13+1。
- `apps/desktop/src/p3j-runtime.test.ts`：日志、长请求、超时/取消、Windows 名称、首帧真实请求体及 IPC 路径边界。
- `apps/studio-web/src/aivora/pro/workflow.test.ts` 和 `ProWorkspace.test.tsx`：工作台流程回归。
- `apps/studio-web/e2e/p3j-regression.mjs`：真实 Chromium，替代桌面出图桥接，无真实供应商调用。

源码测试通过不代表 Windows 安装或真实供应商验收通过。最终日志保存在本目录（仅清理行尾空白），浏览器截图位于 `apps/studio-web/e2e/evidence/p3j/`。

## 审计清单

| 审计项               | 本次结果                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01 跨作品人物提取 | film id 与请求版本守卫；真实组件挂起 A 提取、切 B、返回 A 的回归通过。                                                                                     |
| P1-02 原始响应日志   | 仅落白名单元数据；合成敏感响应与小说不落盘回归通过。                                                                                                       |
| P1-03 长请求         | 取消剩余 7500 截断，桌面 100000 字符显式预算；完整来源发送回归通过。                                                                                       |
| P1-04 段落完整独占   | 严格验证遗漏、重复、非法编号及 P100；真实小说回归通过。                                                                                                    |
| P1-05 镜头预算及 id  | 不截断，按最终场次聚合及唯一编号；超额提示。                                                                                                               |
| P1-06 动作串镜       | 保留模型 shot_id，精确 id 或原文重叠，手动与自动入口均过滤目标镜。                                                                                         |
| P1-07 配音类别       | 字段持久化，结构化优先，原文补推断，同类池复用；实际音色试听未验证。                                                                                       |
| P1-08 首帧参考图     | 桌面入口真实请求体携带图片，HTTPS 肖像不丢；客户端阻止带 refs 无有效首帧提交。**直接调用服务端 HTTP API 的自动首帧仍未改**，因本次未获 services 修改授权。 |
| P1-09 总超时         | 覆盖响应头、正文、兼容重试；超时与取消实际故障注入通过。                                                                                                   |
| P2-01 多场映射       | 明确场次 id、地点、顺序回退测试通过。                                                                                                                      |
| P2-02 多句对白及叙述 | 保留 dialogue[]，连续对白与无标点引号对白回归通过；显式叙述剔除。                                                                                          |
| P2-03 hold_s         | 冒号/等号/空值/非法值统一用户可读文本。                                                                                                                    |
| P2-04 异常与忙碌     | 编剧 finally 清理；三个导演入口显示补充失败；仍可重试。                                                                                                    |
| P2-05 Windows 名称   | 设备名和尾点矩阵通过；Windows 实机写入未验证。                                                                                                             |

## 用户实测清单

| 项目                    | 本次结果                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1 场景后半截丢失        | 保留超额镜头；真实小说每段、每句引号文本及各场末段回归通过；补镜明确要求核对顺序/说话人。                                     |
| 2 打斗动作错镜          | 删除位置回退，手动/自动按 id，缺 id 按源文重叠；移除内部说明。                                                                |
| 3 导演首次卡住          | TEXT_TIMEOUT 自动重试一次，显示第 2/2 次；取消不重试。                                                                        |
| 4 gender/age_band       | 保存后可读回；父亲/爸/阿婆等推断与同类配音测试通过。                                                                          |
| 5 定妆照两次操作/漏脸部 | 单击出图；逐人尝试全部缺失角度，失败可再次只补失败项；真实浏览器通过。                                                        |
| 6 画面首击/进度         | 首次点击即调用，卡片显示生成中；浏览器通过。                                                                                  |
| 7 旧建议残留            | 页面/场次/输入改变及写入后失效，晚到建议有 scope 守卫；浏览器通过。                                                           |
| 8 首场标题              | 从真实原文恢复雨夜旧书店，回归通过。                                                                                          |
| 9 1280×800 排版         | 三行省略、完整 tooltip、独立标签、相邻行无交叠、路径中省略、四行外貌框；截图与 DOM 检查通过。390px 仍有35控件越界，如实记录。 |
| 10 状态文案             | 改为生成/后台任务的直白状态，移除原“草稿成片…不是实拍”提示。                                                                  |

## 已完成的门禁

| 检查              | 结果                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面 Vitest 全量  | 107 文件，1952/1952 通过，覆盖率门禁通过。                                                                                                                      |
| Web Vitest 全量   | 209 文件，3058/3058 通过，覆盖率门禁通过。jsdom 未实现媒体播放的提示不等于真实播放器验收；真实 Chromium 无控制台错误。                                          |
| 提示词包测试      | 37/37 通过；全部岗位示例被产品解析器正确读取。                                                                                                                  |
| TypeScript / mypy | 通过；mypy 检查 309 文件。                                                                                                                                      |
| 构建              | desktop tsc 与 Web production build 通过；Vite 有既存大 chunk 提示。                                                                                            |
| 契约              | contracts:check 通过，无契约生成差异。                                                                                                                          |
| Linux 本地包      | 打包成功；bundled Electron contracts、FFmpeg 8.1.3、Python health 与父进程退出关闭 sidecar 检查通过；随包 FFmpeg 4/4 真实拼接测试通过。                         |
| Linux 真实窗口    | 临时 Xvfb 下 Electron 成功启动；health=ok，name=AIVORA，version=0.3.0。原 snapshot 依赖源被网络拦截，改用环境允许的 Debian 官方源临时提取测试工具，无系统安装。 |

Python 全量及覆盖率门禁未通过，详见下节。本地验证包并非 GitHub release 附件，不能用其哈希冒充发布验收。

## Linux 验证包与发布阻碍

源码提交：`4fbbf8bbc7b736c100acb67c9fc362281ef59ffb`。该提交已推送，未修改 main、未合并、未创建 PR。

本地最终 Linux 包：`/tmp/p3j-final/AIVORA-Desktop-0.3.0-linux-x64.tar.gz`，370116293 字节。构建器报告与独立 `sha256sum` 一致：

```text
db00d7bef63bc2fcd31aded1ac01a8b6c9d23972b2351a22483e5fe9e6607769
```

该确切包的 Electron 窗口 health 与随包 FFmpeg 4 项测试再次通过。此文件**未上传 release**。Windows 安装包未构建，因此没有可提供的 SHA-256。

命令行 GitHub Actions API 请求返回 `Forbidden`；可用 GitHub 连接器能只读监控，但没有首次 workflow_dispatch 或创建 release/上传附件能力。两个安装包流程仅支持指定 PR 或手动触发，不因本分支普通 push 自动运行。本次不会创建 PR 来绕过用户约束。

普通 push 已触发 [ci #402](https://github.com/chen11-A/aijian-studio/actions/runs/41807483626)，head_sha 精确为上述源码提交；Windows/Ubuntu quality 不等于安装包发布流程。正式 `aivora-desktop-v0.3.0-phase3j` tag 尚未创建，release 尚未发布。

## Python 全量失败与待授权项

`pnpm test:py` 实际 exit 1：**5119 passed、3 failed、6 skipped**，耗时 2346.04 秒。失败全部在 `test_film_agents.py`：

- `test_offline_director_uses_the_users_lines_not_the_fight_cast`
- `test_director_repairs_once_then_reports_a_plain_reason`
- `test_director_json_becomes_shots_and_names_only_from_the_reply`

共同原因：`services/api/src/aijian_api/agents/prompts/director.md` 没有 `agent_version: 2`，`agent_runner.prompt_version` 抛出 ValueError。已用 `git show` 核实固定基线该文件也缺此字段；本次 services 没有任何差异。最小修复是在该文件增加上述版本行，**当前未执行**，已请求范围授权，不能把未回复视为同意。

独立执行 Python 覆盖率门禁也 exit 1：行覆盖率 **91.94% ≥ 90%**，分支覆盖率 **83.32% < 83.5%**。没有降低门槛、屏蔽失败或改写测试为通过。

此外，审计 P1-08 的服务端直接 HTTP 自动首帧路径需要 `story_film.py`、`xai_media.py` 及相应回归的修改授权；本次仅修复并防护桌面应用路径。两项 services 授权问题均尚未收到答复。

## 组件 ZIP 后续对齐依据（未导入）

只读核对的 QC 基准提交是 `7c0eea58b218456f59d1f3ba93eddc791fdad894`。实际报告顶层为 `schemaVersion: 1`、`media: {duration,width,height}`、`audio: {present,integratedLufs,truePeakDbtp}`、`assumptions`、`issues`。问题项使用 `id/severity/time/timeLabel/end/type/message/suggestion/action/detail`，按类型可另有 `scope/cue/estimated/nextCue`；不是猜测一个新 report 接口。

字幕 id 应固定为 `white / bar / variety / yellow`，对应中文显示名为“清楚白字 / 底条字幕 / 电影字幕 / 醒目黄字”。由于 ZIP 未找到，没有创建 `next/README.md`、修改 `qcReport.ts`，也没有产生要求署名 chen11-A / Co-authored-by Claude 的独立导入提交。
