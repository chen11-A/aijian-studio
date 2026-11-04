# AIVORA 第32批：手工本地候选、显式装配采纳与原操作恢复

精确总基线 `32d014624aad134a6884121a58a26b75088104c9`；精确父提交
`6d28690b01df7b0303c17b63a31acebe75c3c81c`。仅本地候选分支实施。
设计见 `docs/architecture/manual-media-candidates-and-assembly-adoption.md`。
初始设计沿用开发代号31的原文件名保存；第31批已另行提交四文件UX修复，
本批不覆盖或重述其历史证据。没有操作离线Windows电脑或远端分支。

## 实际产品链

production制作页复用第30批精确制作输入对象，显式选择已保存请求和真实已导入
IMAGE/VIDEO资产版本，保存完整手工关联为 `episode_manual_media_candidate`。
内容包含请求version/hash、asset/version/SHA、完整关联说明和精确资产元数据快照，
固定LOCAL_IMPORT/MANUAL_ASSOCIATION/费用UNKNOWN；不创建Provider任务或复制媒体库。
候选历史使用原artifact_versions，20条keyset分页，旧历史保持原引用和hash。

production装配页读取同作品同分集候选，明确添加或替换画面片段。选入只改变未保存
编辑，另点保存才写原集级装配。片段保存candidate/preparation各version/hash、真实
media ref、分镜shot及MANUAL_ADOPTION；相同帧率才允许选用，不暗中舍入。旧无字段
装配不注入null，保持序列化hash。改绑/解除分镜显式撤销候选来源，undo仍有效。
普通/专业与声音现有装配入口共用同一精确保存对象；本批未接通语音生成或声线授权。

migration46增加两种不可变原写入回执；固定native POST/原GET、top-frame IPC、
preload和实际transport贯通。旧装配POST兼容入口保留，production hook采用完整
UUID/payload/CAS精确写入。原UUID大小写字节保留；完整payload+可信actor归因。
版本、head、dependencies、receipt同事务。commit后投影失败保持500UNKNOWN，
坏回执、404、缺失日志、被另一意图替换或remove无效均不授权再次POST。
session scope持有完整意图跨实际重挂；缺失可补回原X，存在Y保留Y；旧v1装配日志
保持LEGACY_BLOCKED，不从“最新版本内容相似”推断成功或洗掉旧日志。

组合制作页面先检查两个输入的busy/UNKNOWN可保留性，再一次询问未保存输入；
子guard不可相互覆盖。装配另读当前头后才允许下一个CAS，拒绝旧修订、NOT_FOUND
和同修订不同version/hash。历史original的result_revision只归因原操作；动态head
更高只提供下限，不能把历史对象当作当前头。

## 原件、来源与安全

新关联在同连接内精确读所选资产，SQL先限制32KiB技术metadata，再解析闭模型；
实际原件安全路径、32MiB既有限额、SHA/size/稳定文件签名及最新权益均核验。
历史可读不冒充当前原件可用；新装配保存、DRAFT计划/导出再核候选、请求、分镜、
选用参考原件、当前G5权威及所绑定当前剧本确认。旧请求可另存手工关联，不授予
当前G5/确认；对应失效来源仍拒绝新装配和执行。blocking候选→请求→分镜边与
装配→候选边加入原依赖链，实际G5替换传播到这些历史对象，旧对象不改写。

递归物化共用原ImpactMaterializationBudget：所有对白、reference/literal字幕及
显式CONFIRMED脚本在同事务SQL-before-JSON计入预算，保留单源2MiB、累计32MiB。
候选本身256KiB、20条分页共用预算。共享闭模型校验只新增schema-valued typed
additionalProperties字典支持，拒绝无约束字典、bool/float/嵌套值、孤立代理项和超限。
原DRAFT32视觉/32音频/30分钟/1920和原件32MiB限额不变，不冒称完整导出规格。

原electron-only沙箱preload VM发现runtime contracts import回归；本批同时修复此前
确认影响/制作输入的同类问题。preload只保留Electron运行时导入，固定channel字面量
以共享literal类型校验。现有桌面构建为tsc直接输出，不能假定存在bundler。
既有沙箱保护断言完整保留，未以允许额外require来迁就失败。

## 根受影响回归证据

原始命令、UTC、退出码及每次失败/通过输出均在 `evidence/aivora-batch32/`。
以下是不同测试的复用范围，重复运行和子集不相加，不声明全量coverage/CI通过。

- Python12文件185个不同选中测试：初次其余11文件141项通过；提取原件检查后的
  原有44项边界测试迁移故障注入位置后全部通过。初次20个、随后4个旧注入位置
  失败原件保留；原断言与控制不减少。两项真实encoder用例明确未执行。
  本批候选25项包含其中：真实临时SQLite、自有PNG、双作品双分集、事务回滚、
  精确来源错配、原件丢失/变更、最新权益拒绝、SQL技术JSON限额、G5/确认替换
  保留历史且阻止新装配/导出，toolchain禁止控制及执行账本无新增。
- renderer9文件83个不同测试：原8文件77项复用，声音生产入口6项迁移到新精确
  保存/完整状态回执后通过。包括实际装配17、候选/采纳5、journal19；这些子集
  不再累加。声音UNKNOWN明确GET原操作，普通/专业和装配读同对象。
- desktop8文件133个不同测试：原7文件130项复用，沙箱实际preload3项修复后
  通过；其中新精确协议42项，不再累加。只运行协议/VM，不执行Electron或原生IPC。
- 全仓TS no-emit通过；23份生产Python mypy通过；范围ESLint/Ruff、26份Python
  格式及范围Prettier通过。未改变lint配置或放宽type/import规则。
- 另三个受影响formal/typed边界文件50项通过，证明literal DRAFT字幕不能扩大
  正式输出、release allowlist仍为空；不运行原生或encoder，不表示正式输出已接通。
  与前述12个Python文件不同，合计15文件235个不同选中测试。

脚本生成契约成功；旧125公开路径全部逐项相同，新增两个candidate GET；507旧
schemas中506完全相同，仅AssemblyVisualSegmentV1增加可选来源字段；新增8模型。
原操作私有路由不扩大public写权限。完整标准contracts:check通过，已暂存9份契约
文件逐项匹配最终冻结SHA；最终提交前再次核全部65文件。参考远端分支再次只读
核对仍为精确总基线，没有静默换基线或写远端。
default uv缓存只读拒绝原输出保留，未提升权限或改受保护缓存；随后使用本任务早已
建立的许可scratch缓存完成格式命令。lint import类型失败和修正证据同样保留。
最终暂存65源码逐Git blob SHA一致，源码及两文档diffcheck通过；完整暂存raw
diffcheck退出2，71行原证据警告保存在 `STAGED_SOURCE_AND_RAW_DIFFCHECK.txt`。
不为清除此类警告改写已封存输出/源码副本，不新增归档排除或降低检查门槛；本批
范围检查通过不代表完整CI、全仓归档lint或安全审计问题已经解决。

## 独立复核与浏览器边界

独立初审54份早期冻结源码复现两项新P2：保存后坏当前头覆盖输入，以及18份合法
脚本共35,155,880B绕过预算；另重放此前已知日志丢失/typed metadata缺口。
初次13控制7通过6保护断言失败及错误夹具前版/OOM均原样保存，不冒称通过。
第二冻结重放13控制已通过，35,155,880B在SQL预算前拒绝，版本/边/receipt不增加，
182保护trigger完整。最终独立26个不同控制全部通过（17 Python、7 UI、2 JS VM），
另47项与根回归重叠的既有测试单列，不累加。新鲜消费控制包括实际原件/最新权益、
G5实际替换影响、确认身份、fresh save、authenticated preview 409 no-store及导出
preflight禁止toolchain；历史hash保留。17份来源33,202,775B可保存19条依赖并由
历史/原GET读回；18份来源在读取超预算正文前拒绝，不增加版本/边/receipt。
实际候选选入编辑器→原装配save/readback和electron-only preload八调用同样通过。
最终独立122文件manifest及133成员SQLite ZIP逐项SHA核验，已逐字节复制124文件
（包括两份manifest），原初审/夹具失败/数据库不覆盖。报告在
`evidence/aivora-batch32/final-independent-review/FINAL_REVIEW.md`。

最终源码清单65项：desktop10、renderer19、contracts9、API生产23、API tests2、
导出脚本1、架构1，其中测试共8。最终manifest SHA256
`b09919c91099d348da34de94338be90eb5a9790c1cdcb9f30f90732a1e226779`。
只读冻结、初始设计/实现219项历史产物已按独立SHA复制；所有旧tracked/raw证据保留。
中间类型语法及纯测试格式差异明确记录，不覆盖原失败或先前冻结文件。

第五冻结仅在上一最终65项中改两组件和既有测试：保存或核对busy离开时明确提示
等待本次结果，不误报原日志损坏；采纳后的动作通知以上方保存读回状态为准，
避免已保存仍持续宣称未保存。未增加自动保存、重发或改变guard/采纳/写入行为。
既有5项加语义断言后通过，TS no-emit及范围ESLint/Prettier通过；首次断言误放在
尚未busy的guard处导致1项测试失败的原输出保留，测试移至实际busy阶段并用act。
独立增量两相关UI控制通过：一项为原26中的采纳→保存控制复验并增加文案断言；
一项新增case同时覆盖POST和原GET等待，完整原日志/输入保留且POST总数为1。
另既有5项单列重叠，64布尔状态仅为静态等价核查，不按64项测试累加。增量30文件
manifest及两份清单已逐项复制32文件；原26/122项封存未改，报告见
`evidence/aivora-batch32/final-ux-delta-independent/FINAL_UX_DELTA.md`。

受控production renderer使用已安装Vite/Chromium/Playwright，在1440×900与980×680
完成修复前后同流程：普通→专业保持同一scope/完整准备请求/候选说明/asset版本；
候选显式保存写1次；回同分集装配选择新候选，新增75→150帧时saveExact=0，另点
保存后saveExact=1并从真实store读回完整candidate/preparation/media/board refs。
980装配UNKNOWN与候选UNKNOWN各只GET原操作1次，写次数不增加。两输入未保存
一次合并取消确认后保留；busy先阻止离开；候选折叠/Enter展开/Tab入口保持输入。
保存调用瞬间完整journal解码后与本次command精确一致。

8个成功case、70份有效browser observations、89份原PNG（包括诊断失败）及12次
隔离SQLite写入分别核验完整UUID/payload/hash与可信actor-bound request/receipt。
377成员共63,938,207B逐SHA通过，包含所有现存原脚本/步骤/响应/失败/fixture/SQLite
及前后65源码；加3份self-record清单逐字节复制380份。manifest SHA256
`55ce68be9e6091dc4a32437901bcd8c8555cca4ceb33623fd595641fcac10cad`。
父Git字节加65 overlay的1065文件证明和恢复说明保留，原目录未删改；既有31封存
3个SHA未变，两个自有Vite已停止。原root fixture未改；只在审查副本将project
aspect_ratio元数据16:9归一到现有公开DTO9:16，原失败及前后hash都留存。早期导入
alias、exact label及滚轮步长诊断不是产品失败，原脚本/输出仍在manifest中。

报告见 `evidence/aivora-batch32/final-browser-ux/UX32_REVIEW.md`。根另外实际看过
1440保存读回和980busy新提示两张原PNG，未声称检查全部89份像素。完整来源JSON
默认展开需多次滚动仍列UX32-03效率开放项，保存可达；原UX04–08仍开放。此证据
是受控桥加实际隔离store，不冒称Windows原生IPC、模型、编码或真实连续播放。

## 开放范围与交付

正式生成任务/真实供应商与逐次完整内容费用确认、声线/语音/口型、预算产品决策、
实时序列/完整媒体规格、正式审片签发/master/export、Windows安装/关闭恢复/真实播放
和模型质量仍开放。第31批UX04–08继续开放；原Word未逐页核对，23页/五阶段及
所有历史需求不能称已完整验收。没有build/install、原生编译/执行、真实Provider/
图像/视频/语音/费用/凭据、账号工作区/用户电脑操作、推送/合并/远端CI、UNKNOWN重发。
原安全审计、CI/许可/coverage问题与历史归档规则均未静默降低或擅自采纳。

第31批完整累计源码及全部历史证据已经三种方法从精确基线恢复相同Git树；分卷均
小于10MB。第32批完整本地提交后继续做累计补丁/逐提交/随包脚本恢复及全文件hash。
正式Library helper的只读tools/list网络故障仍阻塞上传，未绕过流程或制造附件ID；
本地路径不是下载URL，用户可用最新正式下载仍为父端确认的第27批。
