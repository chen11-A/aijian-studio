# AIVORA 第30批：本集媒体输入保存、历史与原操作恢复

总基线 `32d014624aad134a6884121a58a26b75088104c9`，精确父提交
`4e605b5ca1ef6902a183e5e49b33e62605c43832`。仅本地候选
`codex/aivora-product-local-20261011`；不推送、合并main或改远端。
设计见 `docs/architecture/episode-media-preparation.md`，先经过独立条件审查及重放。

## 产品链及边界

生产制作页现在真实读取本作品/本集已保存分镜，明确选择镜头、编辑IMAGE或VIDEO完整
正负提示词/宽高/帧数，显式另存输入；精确版本列表、历史详情和“载入为新输入”共用原
artifact_versions。输入头只作为CAS追加序列，旧输入不被最新头替换。没有供应商、
模型、账号、价格、授权、job ID、进度、READY或成功字段。普通/专业共用对象和权限。
旧fixture入口与第一批DRAFT审片修改闭环保留。

从分镜真实不可变内容保存完整shot、fps、script/library/visual源pin、所选真实引用快照，
依赖边只指精确分镜，传递沿用原实际来源图。新保存以历史模式验证全部原分镜来源，
所选refs另核真实原件hash/最新权利；不把准备保存签发为今天的新G5。历史读回严格核
不可变源/完整快照/hash/依赖边，不把今日原件缺失改写成历史真相。后续真实派发/候选
消费仍需重新检查当前确认/G5/原件/权利/预算，不能仅使用这里的历史准备。

migration45只添加不可更新/单独删除的原请求receipt。BEGIN IMMEDIATE内保存输入版本、
完整原payload+可信actor哈希/原UUID字节哈希/当次expected_revision标量、CAS及读回，
任何写入阶段故障全部回滚。不另造资产存储，不复制完整输入为第二真相。

真实桌面HTTP→固定top-frame IPC→preload→production transport已连接；浏览器缺
native网关时不能写。POST前journal写入并回读，UNKNOWN只核原UUID/全payload规范hash
的私有GET，URL没有提示词、renderer无actor参数。回执按原input/parent/当次revision
重建完整payload，核trusted local-user。404/无回执/错hash/scope/schema等不会推断未提交。

模块内scope原意图跨实际key和页面卸载重挂；已拥有原意图优先于任何替代journal，
丢失补回原输入，替代保留并锁定。结束时只删除原完整canonical意图并回读，删除无效
保持UNKNOWN。A→B→A、晚回复和hash异步不能归属新会话；历史与分镜刷新不覆盖dirty
输入，导航/unload保护和旧输入精确重开保留。没有自动重发或“强行结束未知”入口。

单准备正文256KiB、源单体2,000,000字节、distinct递归来源正文累计32MiB在SQL取JSON前检查；
拒绝跨度和非唯一依赖边，全页最多20完整对象并共享源预算/精确keyset。正文与DTO
metadata分开计量，metadata预留4096字节不是提高正文上限。工程限额明确可拒绝，
不能称完整制作规模。DRAFT32视觉/32音频/30分钟/1920/32MiB不变。

## 实际检查与独立发现

原命令/UTC/退出码/输出与原失败保留于 `docs/quality/evidence/aivora-batch30/`。

- python-final：4文件80项通过，其中新媒体准备21项；真实临时SQLite双作品双集、
  原UUID/完整input/actor/CAS重开、错hash/shot/旧schema、真实PNG丢失/变更、两阶段
  原子回滚、受认证HTTP、20+3 keyset、提交后响应故障及SQL正文/全页32MiB前置围栏。
  generic immutable append构造坏历史控制保留全部保护trigger；不是健康typed写入。
- renderer-final：5文件101项通过，包括新Panel/adapter13项、实际production bridge接线、
  dirty不覆盖、导航、ABA、替代/缺失/删除无效journal与只GET恢复，及旧review/changes/
  Assembly对白消费者回归。生产native bridge夹具是受控测试，不是Windows窗口。
- desktop-final：1文件22项通过；固定HTTP/完整原payload、header/response ID/hash/
  scope/shot/schema/actor、实际错误code/status白名单、details数组坏回执、重hash矛盾
  snapshot与top-frame/IPC arity。Python strip空白字符集与客户端精确匹配，
  控制分隔符/0085拒绝，合法FEFF不因JS trim差异而永久拒读；完整prompt同规则。
  最后shared语义修复后再跑新Panel/adapter13项及全仓TS，旧入口回归复用本批101结果。协议和受控HTTP不是原生运行或模型验收。
- 全仓TS no-emit、7生产Python mypy、8Python Ruff/格式、范围ESLint/Prettier/whitespace。
  生成4文件前后SHA逐项相同；123旧公开路径与500旧schema全部精确相同，新增2公开
  只读GET路径/7模型，POST和原操作恢复仍为native私有，不扩大浏览器/PWA写入或恢复权限。
  generated.ts沿用既有ESLint ignore，原输出保留1条ignored warning、0 errors。

独立审查保留并推动修复四项初始P2：真实页面重挂可能丢原UNKNOWN锁并采用替代journal；
重新hash的snapshot源语义矛盾；已提交后响应ValueError误返回写前422；健康正文靠近
256KiB时DTO metadata触发客户端永久拒读。snapshot二次复核另发现角色重复/空标题/
无地点环境状态/无库visual pin四种同类残余，均补shared after-validator校验（后端前三
由原shot模型拒绝，pin/library同步补）。又发现否则可归属的错误回执details=[]会删原
journal，已严格拒绝数组并保持未知。原失败控制与最终重放均随独立原始证据保留。
独立最终13个不同控制全部通过（UI2/native7/Python4），5项P2已修复；
另复用root desktop22/renderer13和全页预算1项，以及初期选用Python17项，均不跨阶段
累加为新用例。30份最终源码/文档SHA与原始控制另见FINAL_REVIEW及manifest。有限检查不是全部历史安全审计或完整产品结论。

开发时导入路径、短测试token、create_app夹具参数、类型推断/缺type import、格式、
临时receipt测试缺commit、route编辑语法和测试间session map污染的原失败保留；均按
既有生产认证/闭合数据/isolated test scope修复，没有放宽原安全或减少检查。临时早期
corruption测试曾DROP测试库trigger，最终改为合法generic append加receipt，原日志留存。

## 交付及剩余

累计源码补丁、改变文件/删除表/全部历史原始证据和精确base/head/Git-tree、各卷/各文件
SHA随小于10MB分卷保留；实际隔离精确基线恢复另记录。第29包已经本地三种恢复通过，
官方Library helper在只读tools/list阶段网络失败，未进入prepare/create/finalize；没有29
附件ID。第28官方附件仍保留。第30未成功存入Library前不把本地路径称下载链接。

本批只实现媒体输入准备。下一依赖是精确输入→真实LOCAL_IMPORT手工候选关联→
显式本集采纳→原素材/装配消费者；不能伪装Provider结果。正式任务submit/query/cancel/
输出回收还需要真实验证运输合同，当前Sub2API只有TEXT，不移除限制或臆选付费供应商。
Voice/声线/混音/口型、独立字幕/正式审签、实时预演/PictureLock/master、完整review/
export、预算/费用结算及Windows安装/恢复/窗口播放仍开放。原Word未逐页核对，不能
宣称23页五阶段全部实现或历史需求穷尽。

没有构建/安装验证、C++编译/原生执行、模型图像视频语音调用/收费、凭据/账号工作区/
用户PC/重启动作、远端推送合并/CI或UNKNOWN重发。native profiles仍空、runtime不可用。
旧安全/CI/许可/coverage/历史归档排除和未批准Linux ABA规则保持原状。未来真实调用
逐次展示账号模型完整内容费用额度及不确定性并确认；Windows恢复先核未提交内容，
任何重启先请保存确认。
