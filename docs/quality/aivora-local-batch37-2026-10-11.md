# AIVORA 第37批：16:9项目元数据与生产创建一致性

精确总基线 `32d014624aad134a6884121a58a26b75088104c9`；父提交 `815242d36a3d253429d0ff2deb7ea3024ac799b7`；仅本地候选分支。原35/36提交、封存、原失败与交付保留，未推送、合并或触发远端CI。

## 独立缺陷与本批代码

原36自有16:9项目实际能存，却被公开ProjectData仅9:16合同拒绝，真实界面无法选作品。原36TestClient抛ValidationError未捕获完成HTTP状态，不能追称其原日志已有500；37另用全新自有库、实际认证TestClient明确捕获修前list/16:9 get/settings三个500，9:16两GET200。修后同库各200，DB前后SHA相同，无迁移/改写。原失败独立登记，不混入夹具噪音，9:16自审成功不能覆盖它。

权威PRD竖屏优先且不锁死领域画幅、创建用户选画幅，完整基线P19/P23与父转交用户横屏偏好支持本批有限范围，没有仅9:16权威限制。原Word尚未逐页核对。Python三既有DTO、正常生成合同、共享有限守卫、桌面/renderer创建和元数据读取统一 `9:16 | 16:9`；Home真实弹窗有明确选择。公开请求原默认9:16兼容，当前用户新建默认16:9，旧作品不变。创建回执另一合法比例仍拒绝，await前捕获选值防变动，UNKNOWN保持旧保护且不重发。

project ratio仍只读，不新增比例PATCH/迁移/改旧Artifact/hash；Project、Brief、Assembly不自动同步。VisualBible/G5固定portrait政策保持，未授予横屏正式审核、母版/完整导出。详见[画幅合同边界](../architecture/project-aspect-metadata-contract.md)。

## 验证与原诊断

画幅实现原21源/测试/配置/生成物冻结 `evidence/aivora-batch37/root/SOURCE_FREEZE_FINAL.json`，SHA256 `f2481edbfc7298feecf7725d2425e97cd65587d522a417d323f8e7839f49ce4e`。root六renderer文件146不同nodeid证据链PASS：四文件129与创建三文件42交集Home25，不累加重放；最终Home25、adapter8因受影响fixture/恢复单列回放。新创建两值、readonly设置元数据保持值、旧metadata回执两值、另一合法比例/坏ratio/迟改输入UNKNOWN无重发均覆盖。

桌面77PASS（新27/旧50），另scratch实际捕获GET语义1及原wire JSON两组共3控制PASS，前者不称逐字节wire回放。Python67PASS（新16/旧51，nodeid交集0）。8个安全生产源与父提交逐字节同；仅两个Python生产合同字段模块改变，scoped strict mypy2、Ruff4/format4通过，复用36其他未失效类型证据。全仓TS最终通过，root9文件与shared/desktop scoped lint/format通过。132条旧paths全同、534旧schema中531全同，只有三个aspect const扩大enum，其余顶层/字段/权限全同，0新公开入口/模型。旧比例变更拒绝测试保留。

原诊断全部保留：Python初2新测试错误引用ArtifactVersion不存在字段，修fixture未降业务断言后67PASS；root初类型检查是新adapter fixture遗漏必填字段，补完整后通过。一次Vitest list的可选JSON输出参数误将Home测试文件作为输出路径；保存原JSON/argv，恢复精确36原测试加本批三新控制与真实fixture字段，正常格式后Home25、全TS再检通过。生产与DB未变；不将该工具失误称产品缺陷或忽略。新正确清单只collection不执行case，146是已执行证据去重，不加清单为新测试。

唯一独立生产UI/SQLite审核由professional代理在新scratch、冻结21源上进行。实际原16:9旧作品A→B→A、两个创建选值、rich设置CAS及legacy fallback已经通过；共实际4POST（2创建、2设置，其中1设置已落库但响应丢失），原4装配/heads/refs保持。UNKNOWN恢复仍保留原UUID与journal，无自动POST/原回执GET。980×680实际鼠标发现原rich状态区被父flex压至41.86px，原操作核对按钮被底部裁切，轮滚无法到达；这是实际生产P2，不是画幅或夹具失败，原失败与祖先rect保留。最小修复仅添加既有bounded settings-body及单列CSS，主体滚动、状态滚动规则复用，handler/journal/合同不变。增补23源冻结 `SOURCE_FREEZE_AFTER_UNKNOWN_LAYOUT_FIX.json` SHA `25c8328529ea026aadef03880219f8aff4d91fa89e9b6442facb80df492ca2c6`；原21源逐字节不变，19受影响Editor测试、全TS、scoped lint/format再检通过。实施者两代理不算独立批准；原DB与journal的显式GET/窄窗实际复验已通过：980普通/专业、1440普通各只读原pso回执及当前settings，0新POST/PATCH，原journal确认后清除，DB保持原已落库字节。分层为main/legacy两个业务PASS、原UNKNOWN1POST响应丢失后的原GET闭合、三组布局只读PASS，不伪称五个全流程。最终独立stdlib核验10DB、286完整API body canonical hash、40 SQL artifact hash及20 managed原件SHA；282GET+4POST（2创建/2设置），0PATCH/媒体费用。原36 587成员逐SHA不变。两个browser harness诊断（原创建button locator与post readiness误等disabled input）、一个SQL table regex诊断均保留，与真实PRE裁切P2分开。所有owneddev/browser/worker已停止；独立报告与全部264复制成员已同批封存：262 raw成员26,517,790B，manifest SHA `142a9bb4dceb4d7ef5ae62f97a748c655bfb56bb5620d6b75e1f343d82d586ac`，selfseal SHA `cbcc0fc889eeaf80eaf7c47e0dde7efc35eefce6d7b9fd02d59a38252b09fc08`，报告 SHA `63da3aec596fa497b9c8da9203b825d8b2f8f4a5bc1fa031ac98d9d202446e4a`。每个复制原件尺寸/SHA与独立封存一致；所有原log强制纳入，只有本次新Vite缓存未列，不采历史排除政策。详见[独立生产审核](evidence/aivora-batch37/independent-actual-ui-sqlite/UX37_INDEPENDENT_PRODUCTION_REVIEW.md)。

## 交付与开放项

36轻量源码1,427,395B、SHA `c2c7289a9416e65956d454f6dd0f35d9e497802f924934feebcd43b02e41e9b0` 已封存；6新CAS只含36新增内容，依赖旧35精确23卷。真实owned恢复7624变更/9920文件/37历史map及3914唯一证据blob通过；源码投影不创建目标Git提交。36原rootseal与所有字体/失败原件保持。

37新增源码投影在精确提交后制作；证据只追加尚未封存新SHA。新helper递归核36/35两层的每卷尺寸/SHA、原index、全部历史map/blob，显式重复父目录参数，避免重打36raw或旧字体。源独立应用不需要CAS；完整证据字节树需37增量加原36六卷与原35二十三卷。实际恢复/缺父/篡改拒绝待精确提交验证；原36helper不改。

Library唯一正式保存助手已在prepare/create前网络失败，无新ID/下载链接，不再重试或直接工具fallback。最新用户确认下载仍27，28历史正式保存未确认。本地包路径不是下载链接。Windows原生窗口/真实播放、原始Word逐页、全23页/五阶段全部质量、正式模型/预算/横屏G5/签发/母版与全链失效仍开放。没有构建安装、用户电脑/账号改动、真实Provider或费用；较大布局和预算问题未正式问用户，不能称用户欠答。
