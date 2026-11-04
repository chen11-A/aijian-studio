# AIVORA 第26批：项目设置持久链与明确时基选用

总基线：`32d014624aad134a6884121a58a26b75088104c9`。
本批精确父提交：`a0ea236794ffdc8d5d15ea1bf501200e141215ab`。
本地候选：`codex/aivora-product-local-20261011`；无push、merge/main、远端CI或远端变更。
本批从完整产品矩阵继续实现用户功能，不追加原生适配层冒充产品完成。

## 实际改变

- 项目设置真实名称、说明和默认时基贯通 `ProjectSettingsEditor → studio transport →
preload固定invoke → top-frame IPC → bounded LocalApiClient → settings routes/store →
原workspace projects表 + migration32不可变project_settings_write_receipts`。
  一个project revision负责CAS，没有新数据库或第二套设置真相。省略字段、显式清除时基、
  no-op、单次revision递增和operation身份分别验证。名称/归档旧PATCH共享同一revision。
- 读取当前设置与读取精确operation历史回执分开。重复同请求operation只回原历史结果；
  改内容复用operation或旧revision拒绝。原子事务在metadata和receipt之间失败时全部回滚。
  旧回执重开后保留，不被后续修订覆盖。
- 本地journal仅记录发送命令/请求hash和UNKNOWN恢复身份，不是设置数据库。发送前记录并
  回读；结果丢失/坏回执只GET核对，不重发。核对成功或确定拒绝仅清匹配原记录，并验证删除
  回读；坏/替换/不可读记录保留锁。原请求精确result与当前同revision矛盾或读回回退拒绝，
  保留最高可信快照，重新读取不能绕过；合法更高revision可显示。未保存输入在刷新/冲突时
  保留，导航与beforeunload保护。UNKNOWN只有原记录仍精确持久时允许离开并重开恢复。
- 装配页新增“读取并选用项目默认时基”：只读当前project默认值，经完整回执/作用域核验，
  用户点击后只改本集全空、零帧装配草稿，仍需另行显式保存。不自动改已有视觉、音频、字幕
  轨或已存版本；同集内容变更、换作品/分集和迟到结果均不应用。选用动作无Provider、编码、
  发布、任务、费用。支持原合同五种时码选择；不宣称扩展正式消费者能力。
- 旧name/status项目管理保留。若旧PATCH原journal尚未结束，仍先进入旧精确项目管理核对，
  新链不绕过原UNKNOWN。缺新IPC的旧客户端保留旧设置页；当前桌面接线拥有完整新链。
  普通、专业使用同一组件、数据与权限。

创建时画幅/目标时长/来源语言仍只读，项目级生成/第三方发送/版本策略尚无可编辑合同。
制作意图与整部/单集时长属于独立ProductionBrief，不因修改元数据自动写brief/episode/artifact。
新的设置合同与UI未声称整个P23已完成。没有已提交回执的UNKNOWN继续锁定，缺失回执不是
安全重发证明；不通过伪造零费用、自动再发或猜供应商来恢复。

## 独立审查与证据

独立审查复现并修复四项P2：恢复误删替换journal及删除未确认；真实401/403被错误当UNKNOWN；
未保存输入缺beforeunload关闭保护；精确操作回执与同revision矛盾当前内容被错误当可靠。
另补原记录持久完整性再允许UNKNOWN离开、确定POST 404与GET receipt 404的区别、
最高可信快照及后续刷新不得解锁。原失败复现、修复重放、报告和最终SHA位于
`docs/quality/evidence/aivora-batch26/independent_raw/`，原字节复制SHA单列。
独立报告范围有限，不能据此称全部历史实现没有问题。关闭保护仅受控renderer验证，
不是Windows原生关闭提示或用户电脑实测。

`docs/quality/evidence/aivora-batch26/`保留命令、退出码、原始stdout/stderr、源码SHA：

- 桌面4文件 **53项**：真实bounded LocalApiClient、冻结输入、scope/hash/revision/边界坏回执、
  真实固定sandbox preload调用、top-frame IPC、确定认证拒绝及旧项目/brief回归。
- 界面4文件 **172项**：其中新设置/默认消费18项，涵盖保存、精确读回、UNKNOWN重开、
  无重发、损坏/替换/删不掉journal、原输入、A→B→A迟到读取、关闭保护、冲突当前快照和刷新、
  默认时基无自动消费及空轨/非空轨/同集修改/跨集迟到；其余旧源、装配和bridge回归。
- 后端4文件 **93项**：临时真实SQLite、事务中断回滚、并发两个writer仅一个提交、双作品
  与既有分集/artifact不改写、精确历史回执重开、no-op/清除/省略、旧PATCH CAS、坏时基、
  未授权字段/Unicode/严格revision、真实ASGI认证拒绝。无模型或原生执行。
- 全仓TS no-emit、4生产Python mypy、14TS ESLint、6Python Ruff、格式与contracts通过。
  新公开合同为加法；未降低原CI、coverage、许可、安全或任何门槛。未跑无关全量/coverage，
  未执行构建、安装或Windows/native验证。

重复修复和受影响复核不累加通过数。开发中修复测试夹具共享boundary变异、旧sandbox
preload只允许Electron runtime import、mock类型推断、SQLite表名/HTTP surrogate序列化及
格式/import-order错误；均属本批修复，不静默标为既有。原四项产品失败由独立原复现保留。
此前25批未变代码/Windows未验边界沿用已保存精确SHA证据，没有重复无关测试。
原始测试输出的空白EOF按原字节保存，源码/文档单独检查whitespace，不改日志来伪称原输出。

## 剩余产品与后续依赖

精确a0ea236审计与本批更新见产品矩阵。独立18原源码SHA、18后端/17界面定向检查及两个
临时SQLite复现位于 `product_audit_raw/`：世界/地点人工状态和精确参考真实持久；旧G5已
包括基础scene.assets，但没有独立世界/scv/erf批准；声音/字幕共用assembly且新消费未写
script依赖/完整失效；ProductionBrief真实保存和导演BRIEF_STALE存在，作品级影响仍缺。
下一依赖是正式脚本引用/审批语义下声音、字幕的新消费依赖和失效，以及正式环境批准；
媒体运输仍缺供应商无关正式请求/能力/候选链，当前Sub2API真实运输仅TEXT。
预算两项产品问题仍待用户答复，不阻断这些无费用功能。

原生源码到第25批接通，所有准入列表仍为空、默认不可播放；不继续堆原生安全适配替代
产品功能。Windows二进制/完整许可与loader闭包、真实窗口/播放、质量、安装恢复后续验证。
DRAFT32视觉32音频/30分钟/1920、原件32MiB边界保留；正式review/export/master未闭合。
原Word未逐页核对，不宣称全部历史需求穷尽或完整23页五阶段已验收。
不操作用户电脑、不改账号workspace、不输入或保存凭据、不调用真实模型/图像/视频/语音、
不收费、不自动重发UNKNOWN、不推送/合并/触发远端CI，无安装/构建/绕过拒绝。
转移前仍先检查用户电脑未提交内容；任何重启需先获得保存确认。
