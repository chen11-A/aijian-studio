# DEV05 本机 Sub2API 接入验收条件

候选来源：本目录 `MANIFEST.json` SHA-256 `56E09F7BE264316474FEA6F78EF7560D53266AE394C0DA314803BA34E40FDF24`，`DEV05-LOCAL-MODE.patch` SHA-256 `342A4106E2F0F3BEAE503F0513C4AFCA39586FAA5A2195D5A109175139DC63A8`。只通过 11/11 AST 解析和补丁反向检查，尚未做任何行为、迁移、build 或 provider 验收。DEV01 migration33 依赖未独立验收的 migration32；在完整源整合和 32/33 QA 前，切勿运行升级于生产/旧项目库。

## 独立验收顺序

1. **静态合并门**：核 DEV01 repository/schema、DEV05 后端、DEV07 desktop、前端及生成 contracts 的字段名/枚举一致。`origin_mode` 只对 SUB2API 非空；旧行 `PUBLIC_HTTPS`；其他 provider `null`。九处原 `validate_sub2api_origin` 调用点均传持久 mode。检查 Windows `netsh` 被打包环境可调用，且检查失败时本机派发 fail closed。
2. **迁移门**：在隔离 DB 先独立验证 migration32，再 33 的升级、故障回滚、重开、旧项目与历史记录；不改变原连接 ID、revision、credential_ref、时间戳。metadata CAS 原子更改 mode+URL 并 revision+1，冲突无半写；密钥仍只在 Vault。详见 DEV01 `QA-HANDOFF.md`。
3. **地址契约门**：默认/省略 mode 仅公网 HTTPS；公网 DNS 任一结果为私网、回环、保留或组播即拒。显式 `LOCAL_LOOPBACK_HTTP` 只接受完全规范的 `http://127.0.0.1:<1..65535>` 和 `http://[::1]:<1..65535>`。拒 `localhost`、`127.0.0.2`、IPv4 变体、IPv6 映射、DNS 名、局域网 IP、无端口、0/65536、前导零端口、尾斜杠、空白、凭据、路径、查询、片段、编码分隔符。不同 mode 与 URL 不可交叉。
4. **隔离 HTTP 门**：本机模拟服务监听新的字面 loopback 端口，观察目标地址、请求次数、Host 与 bearer；不得 DNS、代理、重定向跟随或回退。200 JSON 成功只一次 POST；3xx、429、非 JSON、超大响应、发送中断、响应超时分别按既有结果合同记账，发送后不确定状态不得自动重试。公网 HTTPS 原 TLS hostname 验证和公网 DNS pin 不退化。
5. **端口转发负例**：当前 Windows `0.0.0.0:8080 -> 192.168.254.115:80`；以 `127.0.0.1:8080` 做配置/就绪/传输负例，必须在发送 bearer 前拒绝，不探测目标服务。portproxy 探测命令失败、超时也必须拒绝。换用实际 Sub2API 端口时，记录监听进程身份、绑定地址、端口转发状态；本机端口检查仍有并发变化窗口，真实联调前需说明信任边界。
6. **批准与恢复门**：在隔离 DB/fake Vault 上创建任务和一次批准，证实 scope/approval/permit hash 都含 `{origin, origin_mode, connection_revision}`；切 mode 后 revision+1，旧批准不可消费，旧/新 URL 不能互用。消费后发生 `REMOTE_UNKNOWN` 时不再 POST；重启后仍显示 UNKNOWN、无密钥/credential_ref 泄露。并行完成 B31 CAS/轮换/恢复门；G4 claim 和 G5 lock 仍单独 OPEN，不由这里推定通过。
   - 同版 Edit 五组：现存 PUBLIC + 省略 mode + 公网 URL 保持 PUBLIC 且 CAS；现存 LOCAL + 省略 mode + 原 loopback URL 拒绝且零 CAS；现存 LOCAL + 省略 mode + 新公网 URL 拒绝且零 CAS；现存 LOCAL + 显式 PUBLIC + 公网 URL 在 revision 匹配时 CAS 切换且旧批准失效；现存 LOCAL + 显式 LOCAL + 同 URL 的 metadata 编辑 CAS r→r+1、URL/mode/credential_ref 保持。每组记录请求字段是否出现、响应、DB 前后 mode/URL/revision/ref、批准 hash 和消费次数，并重开 DB 读回。显式 `null` 创建/编辑 SUB2API 均应拒绝，省略创建 mode 应仅默认 PUBLIC。
7. **真实本机服务门**：只有完成上述门并装好可信 Sub2API、配置可用模型和专用 API key 后，才在用户控制的测试环境进行一次可计费的真实调用。记录实际 Sub2API 版本、监听端口、模型、状态/响应 ID、AIVORA 操作回执；不记录明文 key。源码路径相符不证明账户配额、模型权限或输出兼容。

当前阻断：migration32/33 整合与 QA、端口选择及 Sub2API 服务身份、真实模型/密钥、G4/G5。此文是验收条件，不是通过回执。
