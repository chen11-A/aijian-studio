# 剧本保存 UNKNOWN 的原操作归因

本次只修复旧剧本保存入口的结束语义，权威范围为 P07/UI-06。
精确父候选 `adce5e18d02f77e33d32ed0266b8d319445c32d7`，总基线仍为
`32d014624aad134a6884121a58a26b75088104c9`。不改变人工确认、制作或费用授权。

## 结束语义

原保存 UUID 是既有 Idempotency-Key/command identity；系统没有保存一个另外的
Provider attempt，也没有持久保存原 POST 的 HTTP request_id。本次 GET 的
request_id 仅用于核对该 GET 的传输回执，不能冒称原 POST attempt。

UNKNOWN 必须保留原作用域、UUID 和完整请求。读取当前 head、读本/场次切换、
重开页面、GET 404/失败，以及用户不再等待，都不能推断原请求未执行。
旧“结束未知记录”入口已移除。没有通过生成新 UUID 绕过未知锁的入口。

仅两类已有明确证据能结束本地 pending：原 POST 返回允许列表中的真实拒绝；
或原保存成功版本经完整归因和精确版本读回。两者都必须条件匹配完整原 intent，
不能只按 UUID 删除被替换的正文记录。未知 GET 错误不属于 POST 拒绝。
恢复成功后仍保持编辑锁，用户必须显式读取当前 head；原历史保存结果不能直接
当作当前可编辑版本。未保存输入不会被原操作核对静默替换。

## 单一真相与只读接口

新增唯一接口：
`GET /api/v1/projects/{project_id}/episodes/{episode_id}/script/write-operations/{operation_id}`。
沿用本地认证边界，不发送 GET body，不请求新的写入权限。

读取既有 `episode_script_write_requests` 中该作用域和原 key hash 的原子回执，
再核验同一个 immutable artifact version。没有迁移、第二存储或状态推测。
回执闭合返回原 UUID/作用域、key hash、request hash 和原不可变版本。
缺原回执返回 `SCRIPT_WRITE_OPERATION_UNKNOWN`，含义仍是不能归因。

后端从原版本正文、author、父版本、修改说明和创建序号重建完整请求 hash；
`version_number` 是不可变创建序号，`head_revision` 是读取时的当前头修订。
不能用当前 head 代替原 expected_revision。旧内容字节/hash 和受限旧请求 hash
兼容规则保持原样，不将缺失的对白呈现自动补成 ON_SCREEN。

实际 desktop client 和 renderer 分别核对原 key/full request hash、正文 hash、
父版本/说明/创建序号及精确 scope。renderer 再 GET 原确切版本并比较完整版本
元数据；允许当前 head 随只读核对推进，但必须再显式读当前 head 才编辑。
旧 desktop 没有原操作方法时保持未知，不回退到 head 匹配或重发。

## 异步与持久保护

保存前捕获独立完整请求，保存前落本地原 journal。当前 scope 持有原 intent；
离开/关闭前补回被移除的原记录，对替代记录不覆盖。原异步回执以 scope/epoch
保护，A→B→A 的迟到结果不能解锁或删除原记录。删除也须匹配完整 intent 并
读回 EMPTY。损坏、不支持或无法持久保存的记录保持 BLOCKED/UNKNOWN。

这不声称解决了外部删除所有存储后的凭空恢复、Windows 崩溃/安装/升级、真实
模型质量或整品验收。审批不调用 Provider、编码、发布或费用。定向检查与独立
生产界面证据见[第39批检查点](../quality/aivora-local-batch39-2026-10-11.md)。
