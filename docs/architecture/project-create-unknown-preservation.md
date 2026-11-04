# 项目创建 UNKNOWN 原意图保留

本批仅修复父线程限定的既定 UNKNOWN 保留/禁止重发缺陷；不扩服务器创建协议。
总基线 `32d014624aad134a6884121a58a26b75088104c9`；直接父39
`0ca3f4dc0a9ad94aecae54600b399490b09e5d65`。

## 已证缺陷与既有保护

入口是 HomePages 新建项目 → model.createRealProject → projectWorkspace adapter
→ desktop createProject → POST /api/v1/projects → repository.create_project。
旧 createPending 阻止同实例重复提交；内存 createUnknown 阻止未知后的立即再次
提交，没有自动 POST。成功 list 却无原操作依据地清 createUnknown，重新开弹窗
又把 UI state 设 idle；provider/page 重开完全丢失内存标记。服务端每次 POST
生成新项目及默认分集，没有创建幂等记录或原操作 GET。

39 的旧单测实际允许 list 后第2次调用。独立39生产 renderer/client/ASGI/SQLite
真实第1次201落库后只丢响应；同原库、原全部localStorage重开，手工list后
显式同完整正文第二POST产生不同项目ID。实测是重开后的用户显式重复，不是
自动重发；同内存list清标记由源码/旧单测证实，不冒称该浏览器路径也已复现。
37丢响应属于设置 pso，不是创建证据；37所有262成员只读复用、不改原结论。

## 最小修复

仍以 projects/episodes 为业务真相，不建服务器表、操作GET、幂等合同或迁移。
新本机 journal 只是已有 localStorage 恢复方式下的创建写入守卫：
`aivora.project-create.intent.v1`。闭合 version1、client_intent_id、完整四字段
input（name/aspect_ratio/target_duration_seconds/source_language）。校验先于
JSON序列化，先保存并逐字节读回，再调用原 POST；原输入以副本捕获。
client_intent_id 是本机追踪UUID，不传入服务器，不是服务端 operation_id、
幂等键或归因回执，不能据它声称原创建已执行或未执行。

UNKNOWN、列表读取、关闭/重开、路由/作品切换和 renderer 重载均保留同原
journal。新建恢复原名称/画幅，保留完整原创建内容且锁输入/提交；没有无归因
结束按钮、自动重放或换UUID绕过。列表/name匹配不能证明原请求结果。

只有仍在当前生命周期和当前请求 generation 内的原直接POST，返回完整四字段
与await前捕获内容一致，且 journal 原字节仍归本次意图，才清记录。服务器对
name的既有 trim 规范化单独按已发布合同比较；其他字段不猜默认。晚于列表
刷新、unmount或替换记录的响应不能清。丢失的同实例自有原记录可仅补回缺失
项；替代、损坏、未知版本原字节不覆盖。存储不可写/读回失败时不发送新POST。
移除后核对失败仍锁，并尽力恢复原字节。同步守卫仅覆盖单renderer有序调用，
不声称localStorage为跨窗口原子CAS。

## 明确剩余边界

现有创建API仍没有原操作归因GET；真正UNKNOWN保持锁，没有成功列表即结束
或证明未执行的终态。旧版已经遗失且从未保存的意图无法自动补回，不伪造旧
UUID或把新本机记录关联旧项目。完全丢失客户端持久数据也不能凭空恢复。
正式归因能力需另行明确范围，不在本批扩大。允许读取/打开已有项目。

这不是Windows原生窗口、升级/崩溃恢复或真实模型验收。电脑恢复后同步先查
未提交内容，任何重启先确认已保存。全部原安全/CI问题、失败、源码包和证据
保留；五项产品新功能未启动。
