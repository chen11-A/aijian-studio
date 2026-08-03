# Phase 0 项目与 TXT 摄取纵切规格

状态：实施中

对应 Backlog：B01、E01、API01、UI01 的首个纵切

## 用户结果

用户可以在桌面端或浏览器开发模式中创建一个本地漫剧项目，导入 UTF-8 TXT 小说，立即看到原文件指纹、章节数、文本块数和可阅读的章节/段落列表。关闭并重新启动应用后，项目和来源仍存在。此切片不调用任何 AI，也不把网页会员当作 API。

## 范围

### 项目

- 项目 ID 和来源 ID 使用带类型前缀的随机标识，创建后永不复用。
- 项目最小字段：名称、画幅、单集目标秒数、源语言、状态、创建/更新时间和修订号。
- 首个模板只开放简体中文、`9:16`、30–180 秒；领域和 API 仍使用显式字段，不把这些值写死在 UI 文案中。
- 重名允许；空白名、控制字符和超过 80 个 Unicode 字符的名称拒绝。

### TXT 摄取

- 只接受扩展名 `.txt`、媒体类型 `text/plain`、严格 UTF-8（可含 BOM），单文件最大 5 MiB；空文件和仅空白文件拒绝。
- 保存原始字节 SHA-256、大小、文件名和导入时间，不把文件路径保存到数据库。
- 统一 CRLF/CR 为 LF，并使用 NFC 生成规范化文本；原始字节不被覆盖。
- 识别 `第…章/节/回/卷/部/篇`、序章、楔子、尾声、后记和番外标题；其他非空行作为段落。没有显式标题的文本归入第 1 个逻辑章节。
- 每个 `SourceBlock` 保存稳定顺序、类型、章节序号、文本、规范化 UTF-8 字节起止和内容 SHA-256。完整 raw-normalized 映射属于 E02，不在本切片伪装完成。
- 同一项目重复导入相同原始 SHA-256 时返回 `409 SOURCE_ALREADY_IMPORTED`，不创建重复记录。

## 持久化与恢复

- 单机使用 Python 标准库 SQLite；每次事务启用外键、busy timeout 和 WAL。
- Schema 使用 `PRAGMA user_version` 迁移，当前版本为 1；数据库新于应用支持版本时只读拒绝，不尝试降级写入。
- 项目、来源文档和全部块在同一 `BEGIN IMMEDIATE` 事务中提交；任何解析或写入失败不得留下半个文档。
- Electron 将用户数据目录下的 `workspace` 目录作为 `AIJIAN_DATA_DIR` 传给 sidecar；令牌和供应商密钥仍不进入环境变量。
- 浏览器开发服务默认使用仓库内被 Git 忽略的 `.aijian-dev`，也允许测试注入临时数据库。

## API 契约

| 方法   | 路径                                    | 结果                                                    |
| ------ | --------------------------------------- | ------------------------------------------------------- |
| `GET`  | `/api/v1/projects`                      | 按最近更新时间返回项目                                  |
| `POST` | `/api/v1/projects`                      | 创建项目，返回 `201`                                    |
| `GET`  | `/api/v1/projects/{project_id}`         | 返回一个项目                                            |
| `POST` | `/api/v1/projects/{project_id}/sources` | Base64 传入原始 TXT，原子解析并返回文档及块，返回 `201` |

所有成功响应继续使用 `{data, request_id}`；失败使用 `{error, request_id}`。稳定错误码至少包括 `PROJECT_NOT_FOUND`、`INVALID_SOURCE_FILE`、`SOURCE_TOO_LARGE`、`SOURCE_ALREADY_IMPORTED` 和 `VALIDATION_ERROR`。Base64、原文、文件路径和内部异常不得进入错误消息或日志。

## Electron 边界

- Renderer 只获得 `health()`、`listProjects()`、`createProject(input)`、`getProject(id)` 和 `importTextSource(id, input)` 五个窄方法。
- Electron main 校验 IPC sender，并通过带 sidecar 令牌的本地 API 客户端代发请求；Renderer 不读取端口、Host、Authorization 或数据库路径。
- 浏览器开发模式使用相同的 OpenAPI 数据结构和同源 `/api` 路径。

## UI 验收

- 引擎连接成功后“新建项目”可用；创建采用带标签的对话框，键盘可提交/取消，错误就地显示。
- 空状态明确解释“先建项目，再导入小说”；已有项目以可选择卡片显示名称、画幅、目标时长和更新时间。
- 项目详情提供清晰的 TXT 拖放/选择区、5 MiB 限制和导入进度；不声称已支持 Markdown/DOCX。
- 导入成功后展示原文件名、短哈希、章节数、块数及章节/段落预览；颜色不作为唯一状态信号。
- 980 px 桌面最小宽度和 320–979 px 窄屏均无水平溢出；主操作具有可见 focus、disabled、loading 和 error 状态。

## 失败测试与验收

- 领域：中文/emoji/NFC、CRLF、BOM、无章节、章节标题、空白、非法 UTF-8、超限、重复 SHA 和字节坐标。
- 数据库：重启后读取一致、事务回滚无半成品、新版本数据库拒绝写、外键生效。
- API/OpenAPI：成功、404、409、413、422、错误体脱敏，生成 TypeScript 无漂移。
- Desktop：IPC 无任意 URL/路径入口，preload 不暴露令牌和端口。
- UI：创建、校验、导入、重复导入、重试、键盘和窄屏；真实 Electron 重启后项目仍存在。
- 格式、lint、严格类型、覆盖率、构建、依赖审计以及 Windows/Ubuntu CI 全部通过。

## 非目标

- Markdown/DOCX、raw-normalized 完整映射、章节人工校对和 10 万块虚拟列表属于 E02/E03。
- 故事圣经、剧本拆解、分镜和提示词编译在来源 Gate 之后实现；本切片只建立其可追溯输入。
- 项目删除、导入覆盖、跨设备同步、服务器 RBAC、安装包内冻结 Python 不在本切片范围。
