# DEV05 本机 Sub2API 同版合同与重新封签建议

## 当前后端候选合同

- `origin_mode`: `PUBLIC_HTTPS | LOCAL_LOOPBACK_HTTP`。旧 SUB2API 持久行经 DEV01 migration33 回填 `PUBLIC_HTTPS`；其他 provider 持久值和响应为 `null`。创建 SUB2API 省略 mode 按 PUBLIC 兼容；显式 `null` 拒绝。LOCAL 必须显式选择并用规范的字面 `127.0.0.1` 或 `[::1]` 加端口。
- Edit 是完整元数据替换。现存 PUBLIC 连接省略 mode 仍按 PUBLIC。现存 LOCAL 连接省略 mode 一律拒绝、零 CAS，包括请求把 URL 改成有效公网 HTTPS；只有显式 PUBLIC + 公网 URL + 匹配 revision 才能切换。显式 LOCAL 的本机 metadata 编辑保持 mode/URL/credential_ref，仅修订号递增。模式变化使旧批准因 revision 与 `{origin, origin_mode, connection_revision}` 绑定不匹配而失效。
- 路由传入 `"origin_mode" in payload.model_fields_set`，服务在读到当前连接及 revision 后拒绝旧客户端对 LOCAL 的省略模式，再执行地址验证和仓储 CAS。没有服务/DB/HTTP 行为测试，以上是源码候选语义。

## 生成合同差异与源码方案

当前 v3 离线 OpenAPI/TS 生成已签封，不手改。生成的 Create 类型把 `origin_mode` 表为 optional nullable，而 SUB2API 运行时拒显式 `null`；Edit OpenAPI 字段有 PUBLIC 默认且非 required，生成 TS 类型却要求此字段；连接响应是泛化 nullable，而 SUB2API 响应应非空、其他 provider 应为 null。这些是生成描述/运行约束差异，不改变 v3 生成本身的静态 PASS。

下个独立候选可从 Pydantic 源合同拆分按 `provider_kind` 区分的创建请求与响应变体，再生成 OpenAPI `oneOf`/discriminator 和 TS union：SUB2API 变体的 mode 为可省略但非 nullable、默认 PUBLIC；其他 provider 变体只允许省略/null；SUB2API 响应的 mode 必填，其他响应为 null。Edit 字段以非 nullable、可省略、PUBLIC 默认描述；若 TS 生成器仍把它标为 required，由 contracts owner 修正生成映射或使用明确的输入 DTO，不手改产物。已有 LOCAL 的“省略 mode 禁止编辑”依赖数据库当前状态，静态请求 schema 无法表达，须在 OpenAPI 描述、错误响应、服务守卫及行为 QA 中明确。

重新封签顺序：DEV01 32/33 数据迁移独立门 → DEV05 新后端候选静态整合 → DEV07 desktop 与前端源合同同版 → isolated OpenAPI/TS 重新生成和差异审查 → MGR04 新复合清单/QA 签名 → 隔离 DB/HTTP/批准行为门 → 可信本机 Sub2API 的真实调用门。旧 B31/c19、已签 v3 只保留为历史证据。

## 2026-10-08 本轮合同决定

本轮保留通用 Create 模型，不重构判别联合；已签 v4 S/G 离线生成结果继续有效。通用生成类型允许 `origin_mode: null` 是多 provider 合同的表达，**不能据此声称 Sub2API 客户端类型静态禁止 null**。SUB2API 显式 `null` 在运行时必须返回 422，QA03 P/API 门须证明 DB/Vault 等持久层零写入；省略字段仍按 PUBLIC_HTTPS 兼容，非 SUB2API 的 null 按其合同处理。UI/desktop 发起 SUB2API 请求须提供有效 mode，或使用约定的 PUBLIC 省略路径，不用类型断言掩盖不匹配；发现具体 consumer 意外发送 null 时修该 consumer。现存 LOCAL 的 Edit 省略 mode 必须拒绝且零 CAS，现存 PUBLIC 省略 mode 保持兼容。判别联合与更精确的生成类型属于以后独立版本化改进，本轮不阻塞。
