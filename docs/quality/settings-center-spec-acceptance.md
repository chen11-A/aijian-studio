# 设置中心 V1 规格验收

状态：规格 Gate（S03，不代表运行时已实现）

日期：2026-08-10

## S03 文档验收

- [ ] 全局、项目、领域/镜头三种作用域明确且不可混写。
- [ ] 八个全局分区、项目交付设置和镜头创作参数均有明确归属。
- [ ] 每个稳定 section ID 只有一个允许的作用域，未知或跨作用域 section 以 `SCOPE_SECTION_MISMATCH` 失败关闭。
- [ ] Schema 草案区分 desired、effective、revision、validation 和 effective source。
- [ ] 敏感值只允许 CredentialRef/系统凭据库，禁止密钥进入项目、Renderer 或日志。
- [ ] 每分区独立保存、失败回滚、dirty、离页警告、缺失配置和并发冲突行为已定义。
- [ ] Provider、预算、安全、权利和 Gate 变更需要审计。
- [ ] API 是 project/workspace scoped；普通 Web 读与受信 Sidecar 写权限分离。
- [ ] Electron 只允许 exact-key preload 合同，不存在宽泛 settings RPC。
- [ ] SSRF、DNS rebinding、重定向和私网策略完成前，连接测试明确不可用。
- [ ] 迁移是加法、可回滚且不复制现有凭据，不改写不可变 ArtifactVersion。
- [ ] 失效矩阵不静默重跑，不覆盖 accepted 版本；`REMOTE_UNKNOWN` 不自动重提。
- [ ] 390px 仍是审片/评论/批准，不开放复杂设置。
- [ ] 六个开源来源均记录 absorb/adapt/reject、许可证和代码边界。
- [ ] S04+ 纵切顺序与完整交付链已冻结；没有真实后端能力时不放可点击开关。

## 未来实现测试矩阵

| 层级             | 必须证明                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Schema           | 严格类型、未知字段拒绝、跨作用域字段/section 拒绝、secret/token/api_key/cookie 值拒绝、版本兼容                         |
| Repository       | 分区事务、revision 冲突、失败回滚、继承解析、加法迁移、备份恢复、审计不可变                                             |
| API/OpenAPI      | workspace/project scope、类型生成、If-Match、权限拒绝、错误契约、effective envelope                                     |
| Web transport    | 只消费后端 effective、dirty 与失败并列、刷新恢复、离页警告、无缓存冒充生效                                              |
| Electron preload | exact-key 白名单、参数/返回合同、错误传播、Renderer 无凭据库和任意路径能力                                              |
| 网络安全         | SSRF、全 A/AAAA 校验、固定已验证地址、实际 peer、Host/SNI、重定向重验、私网/元数据、协议/端口、响应上限、超时、日志脱敏 |
| 任务与预算       | 幂等输入哈希、预算不足关闭、最多一次 QC 重试、取消/恢复、`REMOTE_UNKNOWN` 不重提                                        |
| 失效             | 变更只影响规定下游，accepted 不改写，凭据轮换不让影视产物失效，项目规格精确标 stale                                     |
| 浏览器           | 1440×900 完整编辑；980 可审阅 effective/警告；390 无复杂设置入口；200% 缩放可操作                                       |
| Electron         | 真实凭据状态、Sidecar 权限、离线/失败/重启恢复，无控制台错误和横向溢出                                                  |
| 迁移             | 老 Provider Connection 可读、无密钥复制、dry-run、失败回滚、旧 revision 兼容读取                                        |

## 每个 S04+ 纵切的完成定义

1. 先提交 Schema 与失败测试，再实现 repository 和迁移。
2. OpenAPI、生成 TypeScript 类型、Web transport 和 Electron preload 同步更新。
3. UI 展示真实空、载入、dirty、保存中、失败、冲突、缺失和 effective 状态。
4. 运行定向测试、相关全量测试、typecheck、lint、build、真实 Chrome/Electron 验收。
5. 独立代码审查无阻塞项，证据文件和 SHA256SUMS 可追溯后才独立提交。

## S03 验收命令

```powershell
python -m pytest services/api/tests/test_settings_spec_invariants.py -q
pnpm prettier --check docs/specs/settings-center-v1.md docs/architecture/ADR-0006-settings-scope-and-effective-values.md docs/research/settings-open-source-patterns-2026-08.md docs/quality/settings-center-spec-acceptance.md
git diff --check
```

S03 不应产生数据库迁移、OpenAPI 变化、preload 白名单变化或运行时 UI 控件。
