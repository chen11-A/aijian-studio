# AIVORA 源码交接：累计至第41批

本分支从精确基线 `32d014624aad134a6884121a58a26b75088104c9` 创建，应用云端已验证累计源码投影。源码目标为本地第41批提交 `2b90abaeb7f3c52e6af22b76b200fa042ce111d6`，投影manifest SHA256 为 `6c286c758ff5f8addecb39a08e55611627a8b8ed13d03c7d72205fed28ad1ebf`：503个累计变更路径，2735个源码投影文件逐SHA/mode核对。本分支新增这份交接文档；源码等价提交不等于原41个本地提交、完整候选树或全部Git历史。

原本地历史与封包保留。沿已建立的源码边界，新增 `docs/quality/evidence/` 原始快照不随源码上传，亦不复制凭据、账号状态或用户运行数据；旧归档与字体沿原源码清单保留，不采用新的历史排除规则。部分质量文档的原证据链接指向云端封存资料，本分支不包含那些新原件，不能把引用当已下载文件。

## 权威需求与架构入口

- `docs/product/AIVORA-完整产品需求与验收基线.md`：23页、五阶段、Windows桌面、普通/专业同质量、数据与权限。原Word未逐页核对，不能声称穷尽全部历史要求；不以旧MVP/Fake、PWA或服务器扩建缩减或替代。
- `docs/product/AIVORA-需求实现测试矩阵-20261011.md` 与 `AIVORA-全产品完成度核对-20261011.md`：逐项实现、测试、待验范围。后者的38时点状态须连同39–41质量记录阅读。
- `README.md`、`DOTS_HANDOFF.md`、`docs/architecture/contextual-assistant.md`：启动边界与原架构。生产UI在 `apps/studio-web/src/aivora/`，真实preload/客户端在 `apps/desktop/`，API/store在 `services/api/`，合同在 `packages/contracts/`。
- `EpisodeMediaAssemblyPanel.tsx`、`useEpisodeAssembly.ts`、assembly-exact合同：同一作品/分集的装配、精确版本及原UUID恢复。DRAFT审片、批注、修改计划、显式批准、候选关联/复核复用原revision存储；批准不自动生成、编码、发布或收费。
- 最新专题：`docs/architecture/assembly-workbench-layout.md`、`script-write-unknown-recovery.md`、`project-create-unknown-preservation.md`。

## 累计变更与测试范围

全部源码变更可直接从基线到本交接提交用Git diff查看；Git文件内容应与上述目标的完整源码投影相同，额外只有本文件。累计工作包括生产项目/分集与作用域保护、单一版本/CAS/原意图恢复、手工创作库/参考/来源链、剧本/分镜/本地媒体装配、声音字幕与DRAFT自审/导出、完整需求矩阵，以及39原剧本GET归因、40项目创建UNKNOWN保留、41布局A。

41将保存、相邻原件监看/裁剪、时间轴前置；紧凑/较大与专业右栏收起/恢复保持原组件和输入。独立六尺寸/模式核心、四类输入/UNKNOWN状态和三尺寸专业Tab定向通过，0 POST；这仍是完整原件独立播放器，不应用裁剪/字幕/混音，不是实时合成。装配Inspector对象绑定和AI选中对象上下文的原缺项未补。

41最后受影响renderer六文件58项通过，实际app全src no-emit、scoped ESLint/格式通过；47业务handler及原件读取effect相等，SDK/API/合同未改。R4只有专业CSS叠层/槽位变化，复用未失效源码检查，并用真实鼠标/焦点定向复核。独立31个受控DB未变、310个SQL内容hash、63次原80B PNG读校验，1446案例GET另5bootstrap GET，0 POST；13组有效分层覆盖，不把额外重复六组加验收数。原遮挡、时间轴裁切及Tab命中失败全部保留并修复；窄工具条横滚、较大轨道内滚仍有操作成本。

独立报告SHA256 `89c1738037ab068be49b8526af6842f87a7957cb69f740f49de74d914bb5a5b3`；原816成员manifest SHA256 `47b4d2cb98d425e7fd95295492a2e400a52df02a91c1de18ba4e31d0b754d560`。这些是云端封存引用，未随本分支上传。

39/40的API/native/Python/合同证据按源码未变复用，不把本批计为重新全量通过。39较宽旧native检查仍有1个旧确认fixture失败（68通过/1失败），在精确38副本复现；原安全合同没有放宽。既有安全审计、CI/覆盖率及发行阻断继续有效：查看 `docs/security/security-model.md`、`docs/quality/first-release-acceptance-status-2026-10-08.md`、`windows-release-readiness-2026-10-08.md`。不宣称整仓CI或正式发行已通过。本分支推送可能触发现有CI；不主动运行新工作流。

## Windows、安全与后续范围

父任务已恢复Windows只读核对；本云端工作没有同步、启动、关闭或重启电脑。未验证真实Windows窗口、视频/音频、大文件、安装升级恢复、真人媒体质量、实际模型或完整23页验收。另一个会话先只读检查本机HEAD/分支/未提交内容及运行状态，再比较源码；不要reset、清理或checkout覆盖已有修改。任何重启先请使用者保存并确认。

真实外呼必须每次展示账号、完整模型、全部发送内容、费用/额度及不确定性，由用户逐次确认。不要自行选择付费供应商、输入/保存聊天凭据、扩大账号/工作区权限、重发UNKNOWN或把手工批准变自动执行。预算未知不是0；保留文件丢失/变更、错误hash/旧版本、过期异步与跨scope拒绝。

五项后续缺口：正式媒体生成入口与已选服务协议/实测；Voice声线授权、语音与口型；实时多轨播放及完整规格导出；预算账本/预留/实付与两项预算策略；正式审片签发和Windows发行验收。DRAFT的32视觉/32音轨、30分钟/1920等边界不能改常量后称完整产品。角色身份、真实参考与跨集影响仍按完整矩阵核对，后台存在不等于UI闭环。继续按依赖实施，遇真实产品取舍或未授权外呼再说明具体选项。

本交接仅新分支 `codex/aivora-handoff-20261012`，不合并或修改main；Library没有上传授权，不上传。
