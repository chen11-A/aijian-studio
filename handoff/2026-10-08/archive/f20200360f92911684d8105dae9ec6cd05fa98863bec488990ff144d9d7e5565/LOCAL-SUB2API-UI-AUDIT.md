# DEV04 本机 Sub2API 模式只读核查（与 W1 修复分离）

2026-09-29 作者树静态检查，未改以下产品文件，未安装或启动网关、枚举密钥或请求 provider。

## 当前边界

- `provider-settings-model.ts` SHA `D3E5170B14D69CCF8E2DA1B65DCA0303D930C173917B70ECA7897E10B1F8921E`：Sub2API 预设只有公网 HTTPS 说明和空 origin，没有部署模式字段。
- `use-provider-connection-form.ts` SHA `334F02F179E766CD4E179B99163362397E875503D5E4B5C09982B937056B12CC`、`ProviderConnectionForm.tsx` SHA `5E2460F7AEA45F6775565737F6E15EC0A286D09B6D50DB95772358FDA9A91F87`：创建界面只允许 Sub2API HTTPS origin，并展示“公网 HTTPS”；`type=password` 不回显密钥。没有显式本机模式或端口输入。
- `Sub2APIConnectionManagement.tsx` SHA `555B4D4B5DFD2822920611ACF90B3FE131FBE40E1B13A452F476D96FB27C4ADC`：编辑也只允许 HTTPS origin；换钥匙前持久记录仅含操作 ID/修订，不含明文 key。当前 UI 公网验证较后端宽松，非公网 HTTPS 最终由 desktop/后端拒绝。
- 共享 `studio.ts` SHA `0D8F6CF403A15A1CA73ADBBDD4BB671E61F27AF64DB73BB84C45F7B1F3F007A6`：连接 DTO 取生成合同，B31 元数据命令没有 `deployment_mode`。后端 `provider_contracts.py` 的 create/edit/public response、repository 和 desktop create/mutation 校验目前也没有本机模式持久字段，并明确拒绝 Sub2API 本地 origin。

## 最小候选与归属

1. DEV05 先定义并持久化**显式** `deployment_mode`（例如 `PUBLIC_HTTPS` / `LOCAL_LOOPBACK`），覆盖创建、CAS 编辑、列表/单项读回和执行时连接快照；旧连接的模式解释须有迁移规则，不能仅从 `base_url` 推断。服务端与实际出站客户端共同限制 local 模式的目标地址和重定向。
2. DEV07 在 desktop create/mutation DTO、严格校验、api-client、preload/IPC 和 `studio.ts` 同版本桥中传递该字段；未接到可验证的 mode/回执时维持不可用，不让网页直接连本机服务。
3. DEV04 经新写窗再改上述三个设置 UI 文件、B31 管理面板与必要的 journal 命令类型：显式选择公网或本机；本机只接受字面 `127.0.0.1` 或 `[::1]` 加显式端口的 origin，不能接受 `localhost` 或任何仅解析到 loopback 的主机名；显示模式、规范化地址与当前修订的权威读回。公网 HTTPS 校验和既有私网拒绝负例继续保留。密钥只作为 password 输入及一次写入参数，不进入日志或本地持久记录。

## 本地模拟与 QA 接收条件

- 正例：显式选本机模式，分别以 `127.0.0.1`、`[::1]` 加有效显式端口配置；保存后同 profile 重开，列表回执的 mode、origin、revision 与 CAS 修改一致。用隔离本地模拟服务核连接，记录监听地址、端口、配置 SHA 与请求 ID；readiness 的 `NOT_CHECKED/UNKNOWN` 不冒充实际 provider 通过。
- 负例：无端口、端口 0/超范围、路径/查询/片段、userinfo、编码/反斜杠伪装、`localhost`/`*.localhost`、DNS 指向 loopback、`127.0.0.2`、其他私网/链路本地/通配地址、IPv4 映射 IPv6、重定向到非允许目标均拒绝。公网模式继续拒绝 HTTP、loopback 和既有私网输入；本机模式不能静默改写公网连接。
- 密钥：界面只显示配置状态，不回显值；配置与换钥匙记录、localStorage、控制台和错误文案均不含明文。未知换钥匙只按同一操作 ID 只读查询，不重复 POST。

此文是候选合同与 QA 条件，不是本机模式已实现或运行验收。W1 单文件修复的 patch/SHA 见本目录 `HANDOFF.md`，两项工作不得混成一个取件或审签。
