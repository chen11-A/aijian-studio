# AIVORA 第40批：限定创建 UNKNOWN 保留与累计源码交付

总基线 `32d014624aad134a6884121a58a26b75088104c9`，直接父39
`0ca3f4dc0a9ad94aecae54600b399490b09e5d65`、tree
`bb4cc7cf483ec439b11d17137efd3ba39d7e96e5`。父新授权先只读定位，只有证实
既定保留/防重发违规才局部修复；五项产品新功能暂不启动。

## 风险分类与最小修复

[只读定位](evidence/aivora-batch40/root/READ_ONLY_AUDIT.json)列入口、确切源码
与原测试。旧内存guard阻止立即再提交，未自动POST；成功list无原操作证据地
清guard，重开丢全部标记。旧test实际PASS并允许第2调用。37的lost-response
实际是项目设置，不当作创建故障已验；其262成员逐SHA仍同原封存。

[独立PRE](evidence/aivora-batch40/independent/PRE_INDEPENDENT_FINDING.md)证实
第1真实POST201落库、丢响应UNKNOWN，重开同原DB/storage后显式同完整正文
第2POST得到不同项目ID。只projects/默认episodes新增；0自动重发。同内存
list清guard由源码/旧test证实，不能混称PRE浏览器也完成同会话list路径。

仅4生产文件＋5测试：POST前durable完整原意图；list/关闭/重开/重载不解除；
输入/新建锁定；当前live directPOST完整body匹配＋同原journal才清；迟到、
损坏/替换、存储失败保留。client_intent_id只本机追踪，不是服务器operation
或幂等回执。无新API/表/迁移/合同/自动重发。见[架构说明](../architecture/project-create-unknown-preservation.md)。
最终9文件源码freeze SHA256
`96189333f723508e0c3a2c7c2678157717945c9b2727355f0e1c1b5a242d46d0`。

## 检查与证据

- 7文件128项最终PASS：真实生产组件的 UNKNOWN、读列表/重开、full body坏
  回执、晚于refresh/unmount、被删/替代原记录、存储故障及既有作品/分集隔离。
- 全仓 TS no-emit、9文件ESLint/Prettier、源码/文档whitespace通过。
- SDK/API/OpenAPI/生成合同原字节未改，复用39未失效的native/Python/合同
  证据，不重复无关全量、构建或安装。原native确认fixture失败与CI门未动。
- 随包纯源码应用helper的Ruff最终通过；首轮导入排序/长行失败保留并修正，
  不关闭规则。helper仅转移字节，其实际默认核对/应用/拒绝路径另有证据。
- 首轮5失败原件保留：4个旧成功fixture缺完整duration/language（3类），1个
  旧test要求未知后list解除再POST。修正fixture及危险期望，不放宽生产保护。
  新测试最后一次格式修正只改变health mock调用链空白，AST及非空白字节一致证据保留；
  最终format先失败后通过的原件均保留。简单scanner未重扫描模板尾而失败的
  核验诊断另保留，实际TSX AST/非空白核验通过，不冒称首核验通过。

全staged whitespace exit2仅3份原stdout/stderr的EOF空行与首轮失败DOM输出
行尾空白；原字节保留。源码/文档staged检查通过，不降低CI/安全门。

独立POST复核和最终SQL/API/源字节证明在
[独立报告](evidence/aivora-batch40/independent/INDEPENDENT_FINAL_REVIEW.md)。
独立4个修复后案例通过：正常成功1次、丢响应1次、真实回执metadata被显式
传输故障改name1次，另1个原丢响应闭库/storage独立980重开仅GET。修复后
127 GET、3次原显式POST、0后续/自动POST；正常成功清记录，其余保留同原
完整body/client UUID。list、关闭/重开、A→B→A、home第二入口和真实reload
仍锁；980及1440控件/关闭实际可达。metadata故障原API201与传输副本分开，
实际SDK接受结构，renderer拒绝完整内容错配，不替换为成功DTO。

全证据9DB、191GET、5手动POST（PRE2＋POST3）、196完整API正文hash、
801整表hash、36版本hash出现核验（4唯一）、18托管原件出现核验（2唯一）。
仅projects/default episodes变化；独立只读980重开DB前后原字节相同。
manifest219成员/23,535,677B/39PNG（30浏览器＋9夹具），另2份seal元数据。
全部进程已停；原SQL列名/无模式按钮harness失败及停止身份检查保护路径拒绝
诊断保留，未绕拒绝；依据自有launch PID/log/可读argv核实并停止自有进程。

这是受控云端生产renderer→实际desktop client→ASGI/SQLite，不是Windows
或真实模型/声音/安装验收。所有PRE/harness失败、原完整body、真实SQL和截图
保留，原sealed37/38/39不重写。

## 累计源码包与停点

基于精确32d0146的一次累计源码包包含37累计源码＋38/39＋本次限定修复，
无需用户手工串旧补丁。复用37源码manifest与38/39逐文件前后hash合成，并
与最终Git源blob核对。沿37既有明确前缀边界：源码、测试、配置、架构/产品/QA
等除docs/quality/evidence/外的全部源码投影；原handoff/archive及字体保留。
原包与全部证据/完整Git恢复链均保留，不采用历史归档排除或旧LinuxABA候选。

helper默认只核对，显式--apply才写源码；精确基线、dirty/untracked、新增路径
碰撞、补丁hash/原源码bytes/mode均检查。应用后HEAD仍是32基线、工作区是
待审源码修改，不生成目标commit，也不恢复完整Git树/历史/全部新证据。未变
明确CRLF的PowerShell仅按Git blob规范字节核对，不改物理行尾。新owned源
投影实证与拒绝路径单独保存，不冒称Windows已应用或旧全历史再验证。

项目创建仍缺原操作归因GET；真正UNKNOWN保持锁，旧版已遗失且没有journal
的意图不能凭空补回。五项决策/协议/许可/Windows依赖原39清单保留；完整23页、
五阶段同质量/数据/权限产品尚未宣称完成，原Word未逐页核对。
不推送、合并、远端CI、模型/费用/凭据、用户电脑操作或Library重试。本地路径
只供云端/父线程读取，不是新的下载链接。完成后停在干净本地检查点。
