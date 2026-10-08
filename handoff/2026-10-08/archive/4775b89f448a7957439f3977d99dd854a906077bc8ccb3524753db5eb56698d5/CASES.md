# REAL-TEXT01 QA01 短测例清单（待冻结 DTO 定稿）

- T1 成功：真实文本提案经人工接纳成为 Draft；同项目 latest 与指定 version 权威 GET 均读回同一 version/content/hash/producer attempt，accepted Head 仍为空。
- T2 隔离：另一项目读取该 latest/version 不泄漏；不存在项目、版本、提案给稳定错误且不新增版本。
- T3 输入：错误来源版本、文档、span 或 producer run/skill/attempt 关联被拒；候选/授权/结算/草稿记录不漂移。
- T4 入队：create_remote_source_extract 只生成持久意图与单任务，无 gateway POST、无授权 CONSUME；同键重放仍单任务，异输入冲突。
- T5 未知：模拟发送后回执丢失或重启，保留 REMOTE_UNKNOWN 与原 attempt；再次查询/启动不重 POST、不生成第二提案或 Draft。

执行前置：MGR01 冻结 DTO、精确作者文件清单、目标 worktree 与 SHA；冻结前只读，不跑漂移候选。测试代码和 raw 仅放本 QA01 目录；不改产品及 c19 既有证据。
