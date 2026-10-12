# 分集媒体请求准备：供应商无关、零派发

第30批在制作页实现真实保存、精确输入历史和原操作只读恢复。它是完整媒体生产的依赖，不是完成 P13、真实生成、MotionProof 或正式声音的验收。第一批审片修改闭环和旧数据均保留。真实媒体运输、逐次费用授权、任务提交/查询/取消/输出回收、手工候选及显式装配采纳继续独立实施。

## 单一真相与版本含义

- 使用现有 `artifact_versions`，类型 `episode_media_preparation`，精确 project/episode 范围。每次保存产生一个独立请求输入版本；列表的最新头只是追加序列的 CAS 位置，不代表旧请求被批准、执行或替换。修改输入时另存，旧输入可精确读取。
- 输入保存 IMAGE/VIDEO 意图、完整正/负提示词、期望宽高、期望帧数、精确已保存分镜 version/hash/shot。这里没有供应商、账号、模型、价格、授权、job ID、进度或成功字段。普通/专业使用同样数据及权限。
- 服务端从该分镜的真实不可变内容取得完整镜头快照、fps 和源版本 ID，并验证整套分镜来源、角色服装和环境引用；保存准备不签发 G5、不自动选择今天的源头。只保存准确输入，不宣称其已满足未来派发条件。
- 原始分镜和递归 script/library/visual 来源在 JSON 实体化前使用现有 SQL 字节/跨度/边数量围栏，distinct递归来源正文共享32MiB预算；准备单体上限256KiB在SQL读取JSON之前检查，拒绝准备类型任何跨度和非唯一分镜依赖边；提示词各20,000字。分页每次最多20个完整对象、全页distinct递归来源正文共享32MiB预算，不扫描无界历史。这些是工程边界，不能称完整生产规模。
- 对新保存，先以原分镜验证器历史模式核所有不可变来源及 G5 pin，再单独对所选镜头解析的角色/环境 refs 调用原文件/最新权利验证；不调用分镜整 scope 的 fresh G5 门槛。历史读取核对不可变来源、完整快照、依赖边和哈希，不把今天的文件丢失/权利变化改写成历史内容。后续真实派发和候选消费必须重新检查原文件、当前确认/G5、权限和预算。
- 保存 BEGIN IMMEDIATE 事务中追加版本、原操作回执和 CAS。父版本/expected_revision指当前准备序列头，而非被重开旧输入。回执只存原 UUID 的哈希、完整提交请求/可信本地 actor 的哈希、版本 ID、当次expected_revision标量，不另存输入真相；不允许更新或单独删除。任何步骤失败全部回滚。

## 真实桌面入口与 UNKNOWN

- 固定主进程 HTTP、顶层 frame IPC、preload 和 production StudioTransport 接线。浏览器/PWA 无本地写入口。页面读取当前已保存分镜，用户选镜头、编辑完整请求，再明确“另存制作请求”。不借保存触发 Provider、编码、费用、发布或 workflow READY。
- 保存前 journal 必须落盘并读回；有未归属操作时禁止第二 POST。未知结果只 GET 原 UUID、完整 payload 的规范哈希和可信 actor。缺回执、错 scope、错 hash、坏响应、未知准备 schema、坏分镜 snapshot schema 或无法证明拒绝的错误保持 UNKNOWN，没有未提交推断和自动重发。
- 原操作 GET 在私有 native 路由，查询只带完整payload的规范SHA256，不把提示词放入URL；服务端从版本input/parent与回执当次expected_revision重建完整payload，核其hash与actor绑定，回送原完整payload和已存版本。UUID保留原大小写字节。客户端同时核对原完整 payload、响应 request ID、内容哈希和快照语义，包括镜头标题非空白、角色去重、schema/字段匹配、脚本/库/视觉pin闭合、环境状态所属地点和完整选用refs/owner集合。重新计算hash不证明语义正确。
- 缺失 journal 可从当前会话拥有的完整意图恢复；生产模块的 scope→原意图表跨真实页面/key卸载重挂保留，scope effect和主动刷新均以已拥有意图优先，不能用替代journal覆盖原锁。同 UUID 不同 payload 的替代 journal 不删除，替代记录不能归属、查询或释放原操作。结束时完整规范输入相等后才删除，并读回证实删除；remove no-op 保持 UNKNOWN。实际拒绝回执外壳/error/details必须闭合非数组对象、精确错误码/状态且request ID匹配；其它4xx/5xx保持UNKNOWN。服务端事务已提交后响应构造失败只返回500 UNKNOWN，不能归类写前422。准备正文256KiB和DTO metadata预留4096字节分别检查，保持正文限额不变。A→B→A epoch 与异步 hash 等待均不能完成新会话；dirty、导航和窗口退出保护直到准确归属。
- 历史分页、精确重开和“载入为新输入”不覆盖未保存内容，旧快照可以继续显示；新另存必须重新选择实际已保存分镜。手工素材候选与实际装配消费者下一批复用原素材/权利/装配数据，不能伪装 Provider 结果。

## 必要证据

实际临时 SQLite：双作品双分集、CAS冲突、错误hash/shot/旧schema、原UUID完整输入/actor核对、重开、历史分镜变更、真实选用参考丢失/变更、事务故障回滚及零任务/费用/Provider。

桌面契约与 production 页面：完整闭合输入/输出、request-ID/header/hash、固定IPC/top-frame、dirty/ABA、过期异步、坏回执、缺journal恢复、替代journal保留、remove no-op、UNKNOWN只GET、未保存输入不被重读覆盖。测试只声明本地数据库/协议/受控页面证据，不冒充 Windows 窗口、模型质量或实机播放。
