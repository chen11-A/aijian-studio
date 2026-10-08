# DEV05 — Sub2API 本机模式静态审查（2026-09-29）

## 结论与范围

目标是让 AIVORA 通过本机 Sub2API 使用 AI；仅下载上游源码不能实现该目标。当前 R2/B31 的 SUB2API 接口只接受公网 HTTPS origin，本机 `http://127.0.0.1:<port>` 会在请求、仓储、就绪检查、运行创建和传输层被拒绝。此文件是静态设计与本机只读盘点；未修改产品源码，未安装或启动 Sub2API，未读取密钥，未调用 provider，未做运行时验收。

固定输入：B31 `MANIFEST.json` SHA-256 `B91EE1F989B73E23B4740224643B95F48517F006448DCFD375F91E67C11E35B9`；R2 `SOURCE-COMPOSITE.json` SHA-256 `3A3DA222E44622DA5803AE80D9867FF69296BD394E7AC2132921F3C9C30FAE7B`。审查源根 `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-r2b2\candidate-source`，固定 Python `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\tool-review\sidecar-py312-win-x64-1\python-base\python\python.exe -I -B`。先前逐文件核验 R2 194/194 和 B31 50/50 匹配。

上游 Sub2API checkout `work\sub2api-upstream-20260928` HEAD `9a62841fd124d026cf3694fcf9b79e98addcdbdc`，`backend/internal/server/routes/gateway.go` SHA-256 `1E9C1C93A623619E972A1C578875F7C5FD8158CC65F255E5C0B521BC69718873`：鉴权 `/v1` 组中有 POST `/chat/completions`，与 AIVORA 的 `/v1/chat/completions` 路径结构相符。模型、密钥和实际响应语义尚未验证。

## 本机盘点

- 已检查进程、服务、常见安装目录及 Documents/Downloads 文件名，未观察到可确认的本机 Sub2API 安装或运行实例；盘点不是全盘证明。
- `0.0.0.0:8080` 监听进程为 Windows `iphlpsvc`。`netsh interface portproxy show all` 显示 `0.0.0.0:8080 -> 192.168.254.115:80`。因此 `127.0.0.1:8080` 实际可转发到非本机目标，绝不可作为本机 Sub2API 的已验证地址，也不能向该端口发送密钥。
- 上游 `deploy/config.example.yaml` 的 `0.0.0.0:8080` 只是示例，不是本机实际配置。后续需选未被占用和转发的显式端口，由 Sub2API 绑定字面 `127.0.0.1` 或 `::1`，并确认服务身份、端口归属、无 portproxy 后才尝试本机联调。目标 `192.168.254.115:80` 的服务身份未探测。

## 建议的最小契约

已与 DEV01、DEV07 固定合同为持久字段 `origin_mode = PUBLIC_HTTPS | LOCAL_LOOPBACK_HTTP`。旧 SUB2API 行回填 `PUBLIC_HTTPS`，非 SUB2API 为 `null`；旧客户端未给字段的公网请求默认 `PUBLIC_HTTPS`。只有创建/编辑请求**显式**提供 `LOCAL_LOOPBACK_HTTP` 时，允许严格规范的 `http://127.0.0.1:<1..65535>` 或 `http://[::1]:<1..65535>`；必须带端口、无路径、查询、片段、用户信息、空白、百分号、别名或尾斜杠。拒绝 `localhost`、`127.0.0.2`、IPv4 的其他写法、映射 IPv6、局域网地址和 DNS 名称。持久模式与 URL、revision 原子写入，并共同绑定任务/批准 hash。DEV01 的 migration33 为隔离候选；其前置 migration32 尚未独立验收，整个新迁移链保持 INTEGRATION_HOLD，不改变 B31 固定 schema31 证据。

传输仅为本机分支新增直接连接字面 loopback 的 HTTP 路径；公网 HTTPS 仍解析并筛除非公网 IP，保留 TLS 校验。两支都保持无代理、无重定向、无自动重试、一次 POST、超时及发送后不确定结果 `REMOTE_UNKNOWN`。运行前验证选定端口无 portproxy 且目标为已确认的 Sub2API 实例；端口归属检查无法单独消除检查与连接间的竞争，产品验收须明确该信任边界。密钥继续只经 Vault，响应不含密钥或 credential_ref。

## 需改位置（当前固定源 SHA-256）

| 文件 | SHA-256 | 变更点 |
|---|---|---|
| `provider_contracts.py` | `8C69AAFA39B13253FA46CC43622AD2EAD2A7CFF6596CAFC76A23EFD8CB1BB284` | 显式 mode、严格两类 origin 验证、响应字段 |
| `provider_connection_routes.py` | `8591532DFF70DDB78C7BFF2FFCD1162A1801393F01F3B1C0E90040098EE40C2C` | create/edit 传 mode，响应回显 |
| `provider_connections.py` | `81CF871D80B7013DE46DEAA140664FB9B954F736E0F8A2FEE702ED36F056A946` | 服务写入传 mode，保持 Vault/CAS |
| `provider_connection_repository.py` | `96DAE6694953485C2A5FDD997E19D811B00A713E00EFD5559BF7B1FD1123F053` | create/update_metadata_cas 按 mode 验证，不放宽公共默认 |
| `sub2api_text_transport.py` | `22722588A013B5A0B1C11A2D8D83792A68D264E0453CFF7B73A20750550BF385` | 本机直连分支与公网原分支，统一非重试结果 |
| `sub2api_connection_readiness.py` | `B664D3C848B8651A8B4CF9A8B401A2B87E1E1C29778EE1C89F03C38E3467B299` | 持久化 origin 校验与本机端口就绪 |
| `sub2api_source_extract_policy.py` | `07A2C0887DE561FBE8076E5BF69A71BE1D58CCAB11642344D3DCAFAAED784423` | 运行事实校验 |
| `sub2api_source_extract_run_factory.py` | `A507921159327CD413178DE5B553B51F2A0C3EFA1EF7074BF5E3F31E1733E00C` | 运行创建前验证持久化 endpoint |
| `sub2api_source_extract_store.py` | `1743B148B38CEB26DDF3A0630CEDA05A61DADDFF5BF4EA4A933022B144DAAFFA` | 运行元数据校验 |

新增契约/仓储/HTTP 负测：默认请求本机 origin 被拒，显式本机精确字面量通过；`localhost`、私网 IP、端口缺失、路径、重定向和公网页面 DNS 解析到私网均拒；持久化重启后读回 mode 与 origin；本机单 POST 成功、响应中断 UNKNOWN 且不重试；8080 portproxy 情况拒绝或阻止联调。隔离本机服务模拟与 fake Vault 只证明软件逻辑，不等于真实 Sub2API/模型调用。

状态：DEV05 后端隔离候选已开始，DEV01 migration33 与 DEV07 desktop 为独立候选；未整合、未运行行为验收、未安装或调用真实 Sub2API。
