# DEV04 本机 Sub2API 显式模式 UI 候选（2026-09-29）

作者树：`C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`。仅写 DEV04 四个 desktop renderer 设置/连接编辑文件；写前逐文件核 SHA、备份。本目录 `.before/.after/.patch` 各自对应同名源文件。未改 W1 `episodeMediaAssembly.ts`、共享 `studio.ts`、desktop bridge、后端、c19 或网页端。

| 文件 | 写前 SHA-256 | 当前 SHA-256 | 差异 |
| --- | --- | --- | --- |
| `domain/provider-settings-model.ts` | `D3E5170B14D69CCF8E2DA1B65DCA0303D930C173917B70ECA7897E10B1F8921E` | `392601AA87F304524A72589E8E6D562626E16BD44FD880A02005CF31FC2BFC1A` | 显式 `origin_mode` UI 枚举与严格字面 loopback origin 检查。 |
| `domain/use-provider-connection-form.ts` | `334F02F179E766CD4E179B99163362397E875503D5E4B5C09982B937056B12CC` | `B325EEDEA20E9BF337E6BC9BD5C028041D899DEFB188265E0B54F88C96E713BD` | 创建页选择模式并清除切换前密钥；本机模式只核地址，不进入旧 create API。公网 HTTPS 原路径保留。 |
| `aivora/ProviderConnectionForm.tsx` | `5E2460F7AEA45F6775565737F6E15EC0A286D09B6D50DB95772358FDA9A91F87` | `FAD464B1AD5AC4635D3410839CE676EDEB3C048E3F6CA6275AEFFEFE7D2C55EB` | 模式选择、动态提示与“核对本机地址·不保存”按钮。密钥仍为 password 输入。 |
| `aivora/Sub2APIConnectionManagement.tsx` | `555B4D4B5DFD2822920611ACF90B3FE131FBE40E1B13A452F476D96FB27C4ADC` | `D4ED5475E332E395F99DD1A69886CCE5273AF7826A92413C9BB847A3D79EC00F` | 编辑页模式候选；本机模式不发 PATCH，并停用当前公网连接的换钥匙与 readiness。 |

本机地址候选只接受 `http://127.0.0.1:<port>` 或 `http://[::1]:<port>`，端口为十进制 1–65535 且必须显式填写。正则按整个字符串匹配，因此 `localhost`、域名、`127.0.0.2`、其他私网、路径、查询、片段、userinfo、编码、缺端口等均不通过。UI 不会访问 URL，因此重定向最终目标必须由 DEV05/DEV07 的实际出站边界拒绝；不能将 UI 格式检查称为网络安全验收。本机网关也不代表上游 AI 离线。

DEV01 已提出持久字段 `origin_mode: PUBLIC_HTTPS | LOCAL_LOOPBACK_HTTP`，仅 Sub2API 非空，旧连接回填 `PUBLIC_HTTPS`。当前后端/desktop/Web DTO 尚未同版本接入该字段，所以本候选**不保存本机连接或编辑**，也不显示本机 readiness 成功。待 DEV01/05/07 完成 create、CAS edit、list/readback、持久化和执行时 mode 绑定后，DEV04 再申请独立写窗将候选输入接入权威回执；不能把仅选中的 UI 模式当作已保存模式。Migration 32/33 的依赖与审签属于 DEV01/统一 QA，本 UI 不预设已生效。

QA 静态与本地模拟条件：切换两模式时公网 HTTPS 旧负例不变；本机两个正例只得到格式确认与“未保存”提示，无 POST/PATCH/provider 调用。逐项试 `localhost`、私网、伪装域名、IPv4/IPv6 变体、无端口、端口 0/65536、路径、userinfo 和编码输入，均不得显示可用；本机模式下旧公网连接的换钥匙/readiness 不可操作。后续同版本集成需在隔离 profile 用本地模拟服务核持久 `origin_mode + canonical base_url + revision` 的创建、CAS、重开读回、redirect 禁止与密钥不落日志/本地记录。开发按指令未运行 build/tests、Electron UI、provider 或网关安装启停；静态差异检查未见尾随空白。
