# AIVORA 第29批：确认来源替代的原子持久影响与精确恢复

总基线：`32d014624aad134a6884121a58a26b75088104c9`。
本批精确父提交：`d5a5596397337b4d8dd07f8597a7bc2be79223da`。
本地候选：`codex/aivora-product-local-20261011`，仅本地，不推送或合并。
设计见 `docs/architecture/script-confirmation-impact-ledger.md`。
本批补第27批声音/字幕来源的持久确认事件及三个实际入口；确认仍是来源事实，
不制造 Gate、accepted head 或正式声音/字幕批准。

## 实际持久链和消费者

沿用原 `episode_script_confirmations` 和原完整请求幂等键。migration44 为旧回执写
不可变 `impact_coverage_version=0`，新回执明确写1；审计rowid只记录迁移边界，不决定覆盖。
旧记录没有当时的影响快照，精确返回 `UNCOVERED_LEGACY`，不回填或伪造旧影响。
新确认在原 BEGIN IMMEDIATE 中保存原回执和同一 `script_confirmation_impacts` 报告；
中途失败全部回滚。已有覆盖回执缺报告、旧链或投影损坏时拒绝新写入和只读查询，
不能显示空历史或跳过错误。

首确认为 BASELINE，同一版本/hash再确认是 SAME_SOURCE，只有实际不同来源是
SOURCE_REPLACED。报告固定真实旧/新回执、精确版本/hash/分集、真实完整依赖边与原因路径。
最弱路径决定单原因强度，最强实际原因决定消费者分类。新增独立纯领域输入，
不借用虚假批准头；旧 Gate 算法默认行为不变。

声音、参考型旧字幕和剧本生成文字字幕分别快照实际来源block、源音频asset/version/hash/
sample区间、文字/render profile以及原保存的帧区间/时基。旧参考型字幕合法绑定 ACTION
时保留原合同；真实录音/文字字幕仍必须绑定对白。分镜与装配投影固定历史shot ID、
标题、时长和精确分镜引用，不读取新版推断标题。旧无依赖但确实引用旧来源的装配
只记 `LEGACY_CONTENT_REFERENCE / ADVISORY_LEGACY_REVIEW`，不伪造依赖边或阻断批准。
历史投影核不可变媒体身份/hash，不要求今日原件、权利或probe仍存在；新消费的fresh
准入、DRAFT最终事务和原生计划仍沿用第27/28批检查。

读取是实际认证API→主进程GET client→固定IPC→preload→生产transport→同一History组件。
修改页看作品历史，声音及装配共用原 EpisodeMediaAssemblyPanel 看本集历史；
原 Gate 影响入口保留。分页是作品级keyset，详情明确选精确report ID，摘要/正文/路径/
canonical hash双端验证。A→B→A、详情/hash异步过期、跨作品或坏回执保持未知，
读取不改装配/script输入、不保存新版本、不执行编码/Provider/费用。

## UNKNOWN与完整原操作核对

原操作GET使用原UUID字节、完整原payload和生产可信主体 local-user；大写UUID不被
规范化成另一幂等键。该原生私有路由不进入公共OpenAPI，renderer不能传actor。
GET返回原确认及其精确报告或真实旧覆盖缺口，不能用今日current状态归因原操作。
后续确认已替代时仍可证明历史原提交完成；它不会被误当今日权威。
404/未知/坏内容不是明确未提交，不放行重发。

Script Editor 发出POST前持久写原intent，并保留作用域内原intent内存锁。
丢失记录恢复原canonical intent；相同UUID但不同payload的替换记录原样保留。
只读精确核对后才可删除完整匹配的原intent，删除后回读；删除无效/替换/坏回执继续锁定。
原无归因“结束未知确认”入口已替换为只读核对原确认提交。来源刷新不能解锁，
迟到旧请求不能释放新作用域busy或删除新日志；未保存内容及导航/unload保护保留。

工程控制限额为10,000版本/40,000边/10,000路径/深度64/1,000消费者，
每消费者最多2,000来源段/1,000分镜引用，单投影2,000,000字节、总assessment12MiB，递归来源正文累计32MiB。
旧装配扫描最多1,000版本/累计32MiB。SQL长度/来源span/依赖预检查覆盖当前确认剧本、直接消费者和装配/分镜递归的剧本、创作库、视觉来源，在对应正文物化前执行，
遍历在追加/下降前拒绝超限；不截断、不扩大DRAFT限制或冒称完整导出规格。

## 已执行证据

原始命令、UTC时间、退出码、stdout/stderr、失败修复记录和最终SHA保存于
`docs/quality/evidence/aivora-batch29/`。

- `python-final`：7文件73项通过，包括真实SQLite原子回滚三写阶段、43→44迁移、
  重开、原操作归因、双作品双分集同库隔离、历史hash、exact路径/shot/段、限额、
  orphan与认证HTTP，以及原装配/领域/生产边界回归。
- `renderer-final`：5文件111项通过，包括实际编辑器/装配、新历史页、全原请求恢复、
  A→B→A、missing/replaced/delete-no-op、坏回执、未应用输入及writes=1。
- `desktop-final`：2文件33项通过，使用真实后端闭合夹具；GET全原payload、
  可信主体/UUID/hash/路径/旧schema/作用域、response ID/大小及top-frame IPC。
- 全仓TS no-emit、10生产Python mypy、范围ESLint/Ruff/格式/whitespace通过。
  合同重新生成前后三文件SHA完全相同；120旧路径与481旧schema全部精确相同，
  仅新增3公开只读路径及19模型，私有原操作不公开。

独立审查先证明并修复三项P2：旧ACTION参考字幕被错误当对白，大写UUID被读取规范化，
以及covered回执缺报告被空历史掩盖。原失败、修复重放和限定设计/中间审查保留。
最终复核另证明并修复：确认POST无归因4xx会清journal；现native及renderer共同限制到该写入实际错误码/状态/闭合回执，不接受GET专用缺失码或任意4xx。旧装配次要引用通过既有验证器先物化2M+剧本才拒绝；现递归源SQL预检查及累计预算先拒绝，保留所有原完整性检查。该控制用原generic repository合法append构造超限stored source，typed script writer不会产生它，不能宣称健康typed source或资源耗尽实测。带后页但首个作品页无本集记录的空态已改为“当前已读取页面”，不宣称整集历史为空。最终独立复核15个不同控制全部通过：4个无归因4xx、6个原UUID/完整输入/actor/路径/旧覆盖/journal控制、1个递归物化、2个真实SQLite历史/media控制、2个真实默认bridge/分页控制。独立另选16后端/19桌面/98界面项与根范围重叠，不累加为新用例；中间9个后端控制另有原记录，也不跨阶段重复累加。冻结41份源文件逐项SHA一致，有限审查未留已证明的P1/P2，不是整品或历史安全穷尽结论。全部原失败、脚本、重放和快照以及必要SQLite控制ZIP保留于 independent_raw，临时测试工作库原目录仍保留。

开发中SQL trigger alias误用new造成二次确认失败，现使用receipt；测试夹具误取media字段、
无provenance文字字幕和重建brief未带CAS已按原生产合同修正，没有降低保护。
命令误写不存在测试路径的失败原样保留并按实际文件重放；导入、行长、类型、
格式和旧断言错误保留原输出。跨包联合测试曾越过desktop rootDir，现分为各包真实native守卫和renderer独立journal守卫，不改tsconfig；旧通用REJECTED/post夹具改为真实POST码/canonical UUID。原生与renderer联合原复现仍保留独立证据。直接Ruff命令曾尝试只读默认UV缓存而失败，后续使用原已授权workspace缓存，没有写拒绝路径。不同阶段重复和独立重叠检查不累加为新用例。

## 交付与剩余

累计恢复补丁与完整改变文件将按每份小于10MB保存正式Library附件；源码恢复与详细
验收记录分卷，完整manifest、各文件/卷SHA和精确Git树恢复证明随交付保留，
不删除旧证据缩小包、不拿本地路径冒充下载链接。第28及之前附件继续保留。

下一依赖是供应商无关媒体输入/任务/候选持久流程和实际用户入口，不自选付费供应商，
不把LOCAL_IMPORT改名为真实生成。正式媒体运输、真实声音/声线/混音/口型、独立字幕
审签、PictureLock/master、完整实时预演、正式审片导出、预算结算与Windows仍开放。
旧确认没有历史快照是明确缺口；原Word未逐页核对，不能证明全部历史需求穷尽。

未执行应用构建/安装、C++编译/原生进程、Windows窗口/播放或真实模型/图像/视频/语音。
原生profile为空、runtime不可用，DRAFT32视觉/32音频/30分钟/1920/32MiB不变。
不推送/合并/main/远端CI、不收费/凭据/账号工作区/用户电脑动作、不自动重发UNKNOWN。
旧安全审计、CI、许可、coverage、历史归档排除及未批准旧Linux ABA规则保持原状。
未来每次真实调用仍需展示账号模型完整内容、费用额度与不确定性并逐次确认；
Windows恢复同步先检查未提交内容，任何重启先请保存确认。
