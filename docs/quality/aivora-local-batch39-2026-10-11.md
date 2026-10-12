# AIVORA 第39批本地检查点

总基线 `32d014624aad134a6884121a58a26b75088104c9`；直接父候选
`adce5e18d02f77e33d32ed0266b8d319445c32d7`，父 tree
`a263803fe6f8947cc0e6f3e6debc3be02566c028`。仅本地候选分支，不推送/合并/
远端CI/真实调用/用户电脑操作。原 Word 未逐页核对，完整产品未宣称完成。

## 唯一修复

独立审查在精确38原字节生产UI复现：唯一 script POST 已201落库，只丢响应；
“舍弃草稿并读取”只读当前 head，旧“结束未知记录”随后清除原 journal 并允许
新编辑。旧 notice 诚实标明“未归因”，所以不报为假保存成功或自动重发；缺口是
原未知请求未归因即可结束并开启下一新操作。

本批移除该结束入口，新增仅原保存 GET，复用既有原子 write receipt/immutable
version。核对 UUID、scope、完整 body、author/request/key/content hash、父版本、
修改说明和不可变创建序号；再读确切版本。成功后仍须显式读当前 head 才编辑。
同 UUID 不同正文、旧 scope/epoch、GET 缺失或失败均不解除 UNKNOWN；原意图
丢失补回、替代保留，原操作不自动重发。没有新业务存储/迁移/Provider/费用/
自动审批。具体语义见[架构说明](../architecture/script-write-unknown-recovery.md)。

19个源码/测试/合同文件最终 freeze SHA256
`0e1a201a9a06fe923446305a35b99b0d15522988f9057239564fafdcdda3535a`。
独立4个场景每次前后均核这19份原字节，文档/新证据封存不改生产代码。

## 检查与保留的失败

- renderer 4文件118项最终通过，包含原确认、场次/读本、UNKNOWN、dirty、原
  请求替换/移除、坏回执、scope/ABA/迟到以及恢复后显式 head 读取保护。
- 新 native 25项通过；受影响旧 script transport 21项通过，二者共46个定向
  通过项。较宽旧 native 文件加新文件为68通过、1失败；失败是旧确认测试发送
  `REVISION_CONFLICT` 而较早严格确认合同只接受真正的确认拒绝 code。精确38
  隔离297源码/合同文件投影实际复现同一失败（5通过/1失败/38跳过）。原测试、
  安全合同和失败原日志保留，未改确认门，未声称该宽检查全绿。
- Python 3文件46项最终通过；11项新原GET/双作品双分集/原版本/历史字节与
  hash/认证/损坏证据，复用35项原 store/dependency 回归。
- 全仓 TS no-emit、strict mypy 288源通过；12 TS范围 ESLint，4 Python范围
  Ruff/格式，受影响源码/生成合同 Prettier 通过。无构建、安装或无关全量测试。
- 正常 `contracts:check` 通过。先 stage 明确的新合同，检查实际工作区→index
  可重生成一致；132旧路径/534旧schema逐对象不变，仅新增1 GET/2闭合DTO。
  不将 stage 合同检查冒称原 HEAD 完全没有新增合同。
- 首轮新夹具失败保留：POST拒绝测试使用非真实 `DENIED/REJECTED`，首版保存
  夹具把无parent首保存写成version2；改为实际code与创建序号，不放宽生产保护。
  首轮Python故障注入被真实不可变触发器拒绝，改为内存读证据注入并另断言SQL
  触发器仍拒绝；不关闭触发器。首轮TS unknown narrowing修正后类型通过。
  初次未落stdout的Prettier preload语法错误另作工具回执说明，不重构假原日志。

源码/4文档的 staged whitespace 检查通过；全 staged 检查 exit2，仅6份原
stdout/stderr末尾空行。原日志原字节保留，不删除空行或降低源码/CI门槛。

所有已落stdout/stderr、argv/exit/hash、重跑与旧确认失败以及38隔离投影输入
清单在[root证据](evidence/aivora-batch39/root/)。未修改旧封存文件或CI/覆盖门。

## 独立实际操作

独立生产renderer→实际 desktop client→authenticated ASGI→自有SQLite，使用
38原夹具/原唯一201操作。1440×900普通和980×680专业各完成重开、读本视图
切换、原GET归因、成功后仍锁、显式读取head后解锁；真实提交前DB的原GET404
保持pending；真实200响应正文被传输故障改text且声明hash不改，实际SDK/UI
拒绝归因，恢复正常传输后仅第二次用户显式原GET归因。共4完整通过场景，
全部0新POST。成功响应来自真实API/版本，不使用成功DTO替身。

原PRE选择器失败、唯一POST/完整journal/body/header、原201/精确SQL证明、
全部截图/DOM/HTTP/DB及传输故障前后body分开保留。完整计数/哈希/开发进程
停止证明见[独立报告](evidence/aivora-batch39/independent/UX39_INDEPENDENT_SCRIPT_UNKNOWN_REVIEW.md)。
独立证据总计7份数据库、155次GET、旧入口唯一1次POST；修复后104次GET、
0新POST，4份修复后数据库前后物理字节一致。保留156份完整API正文hash、
74份SQL artifact正文hash、623份整表hash、14份托管原件字节hash；新证据
manifest封存174个成员（含30张PNG），manifest及自身seal另2份。两次
stdlib核验脚本失败及修正版原件均保留，最终SQL/API核验通过。

这里是受控云端浏览器证据，不是Windows实机、真人创作/声音质量或真实模型验收。

## 剩余范围与交付

GET404/失败保持未知，没有“停止等待即可证明未执行”的终态。已损坏/不支持
的旧 journal 仍阻止写入，不做静默迁移或猜正文。项目create原GET归因缺口仍
开放。Windows关闭/崩溃/升级与真实播放/模型待电脑恢复；同步前检查未提交
内容，任何重启先确认已保存。

正式媒体、Voice、实时成片、布局效率和正式交付仍按完整需求保留。预算原两问
和专业布局A/B是待选项，非用户已经欠答；MLT/真实服务协议/合法声线与输出
规格另列工程及验收依赖。DRAFT限额不改、正式签发仍阻断。

本批交付仅38→39增量补丁、小型源码包、完整新39证据及文件前后hash；依赖
精确38封存树。另在全新自有稀疏index检查增量tree与所有新文件SHA/mode，
不重新复制/验证全部旧字体和历史卷，不冒称Windows应用。Library不重试；本地
路径仅供云端/父线程读取，没有新的正式保存ID或用户可下载链接。
