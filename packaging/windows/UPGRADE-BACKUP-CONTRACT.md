# Windows 升级前数据备份契约

状态：待 DEV05/DEV07 接口与独立 QA 核准。当前 `installer.nsh` 在 `customInit` 检出旧安装时直接中止，防止在尚无备份能力时覆盖旧版本。

## 安装器顺序

1. 对已核定身份，检查 HKCU 安装登记、旧 `AIVORA.exe` 和 `%APPDATA%/AIVORA` 留存用户目录；命中任一项即中止当前安装。该检查尚未覆盖未经核定的历史安装身份，不能据阴性结果宣称旧数据不存在。运行时包固定 `productName=AIVORA`，但实际安装后的 Electron `app.getPath('userData')` 仍须独立 QA 读回。
2. 要求旧 AIVORA、旧 sidecar 及任何会写 `userData/workspace` 的进程关闭。安装器不能强杀后立即假定数据静止；helper 必须检测仍被占用的 SQLite/资源，失败即停止。
3. 从**新安装包**内将独立 sidecar backup helper 解压到 NSIS 临时目录，在覆盖旧程序前运行 `aijian-sidecar.exe --backup-workspace <绝对已存在的 userData/workspace> --output <绝对不存在的备份目录>`。不能要求旧版 sidecar 已支持新参数。helper 不启动 API 服务、不迁移数据库、不请求 provider。
4. helper 从经实际旧版身份映射和 Electron 读回核定的唯一 workspace 源复制到用户可访问、全新且不在源树内的备份目录；`%APPDATA%/AIVORA/workspace` 目前只是待核路径。DEV05 当前静态实现将 `workspace.sqlite3` 用 `sqlite3.Connection.backup` 到新目标并做 `PRAGMA integrity_check`；固定媒体目录为 `media-assets`、`fake-media`、`exports`。拒绝未知根项、链接、junction、源外路径与目标内回环；逐文件记相对路径、大小、SHA256。SQLite WAL/SHM/journal 不逐文件盲拷贝。成功 stdout 单行 JSON 的 `event=backup-complete`、`schema_version=1`、`output`、`receipt_sha256`、`file_count` 绑定目标 `receipt.json`；失败 stderr 且非零退出。
5. 安装器核 helper 退出码、receipt schema/结果、目标非空、清单所有文件存在且 SHA 相等；只在全部通过后进入覆盖旧程序的 install section。任何一步失败 `Abort`，保留旧版、原数据与诊断证据。已创建的不完整目标由 helper 只在本次独占临时目录内清理，绝不删源数据。
6. 独立 QA 用真实旧版安装注入磁盘空间不足、文件占用、损坏 DB、helper 失败、中文路径，并从备份在隔离位置恢复 DB/媒体/项目后读回。跨文件一致性需在无写者状态实测；单个 SQLite 备份成功并不证明整个 workspace 快照一致。

实际用户数据目录必须用打包后 Electron `app.getPath('userData')` 读回与安装器路径一致；当前路径是待证假设。旧安装身份、backup helper 独立 exe 运行、SQLite/媒体恢复和进程退出判据未获 QA 验证前，`installer.nsh` 的升级拒绝不得解除。DEV05 的 CLI 目前仅有静态解析与 diff 检查，不能当成可用工具。

## 旧版身份与凭据边界（静态审查）

- 当前桌面源码 `apps/desktop/src/main.ts` 仅在未打包的 E2E 模式调用 `app.setPath("userData", ...)`；打包分支把 `app.getPath("userData")/workspace` 传给 sidecar。运行时包的 `productName` 固定为 `AIVORA`，但仍须对实际打包程序读回 `app.getName()`、`app.getPath("userData")` 和工作区位置。不能仅由配置文本断言 `%APPDATA%/AIVORA` 已被使用。
- 源码桌面包名为 `@aijian/desktop`。若历史安装包使用该名称、另一 `productName` 或自定义 `userData`，旧工作区可能不在当前 `installer.nsh` 只检查的 `%APPDATA%/AIVORA` 下。旧版的安装登记键、可执行文件名、`appId`、`app.getName()`、`userData`、工作区和数据库路径均需从**实际旧版安装**记录；未取得映射前，不能宣称现有 NSIS 门覆盖所有升级路径，也不能把发现的旧目录自动迁到新目录。
- `services/api/src/aijian_api/credential_vault.py` 使用系统 `keyring`，服务标识为 `aijian-studio/provider-api-key`，账号键为数据库中的 `credential_ref`（旧连接初始值为连接 ID，轮换后可变）；工作区数据库只持凭据引用。备份工作区不等于导出系统保管的密钥。验收只核引用身份、状态和升级/卸载后可用性，不读取、打印或复制密钥值；服务标识或账号映射变化须由 DEV05 单独核定。
- DEV05 静态核对 v30→31 数据库迁移：旧连接的 `credential_ref` 取原 `connection_id`，原有 keyring 槽并不随数据库备份复制。仅在同一系统账号、同一 keyring 后端且旧槽仍存在时，旧引用才可能继续解析；跨账号、跨机器或系统凭据丢失时，数据库中的引用可能变为 `MISSING`/`UNAVAILABLE`，应由用户明确重新配置，不能自动外呼、轮换或声称密钥已从工作区备份恢复。DEV05/独立 QA 仍需以隔离旧版数据库和假 Vault 验证迁移、缺槽及轮换后的读回。
- 独立 QA 用隔离的旧版 fixture 验证目录映射、备份恢复可读性、数据/凭据引用保留以及备份失败时旧程序和原数据不被覆盖。`customInit` 当前仍只是拒绝已识别的旧安装/目录，不是升级实现。历史身份与目录未穷尽前，首次安装判定也不能当作“机器上没有旧用户数据”的证明。
