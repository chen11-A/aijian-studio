# AIVORA 第35批：保存装配的正式制作前置核对

精确总基线 `32d014624aad134a6884121a58a26b75088104c9`；父提交 `e0533c425714e357aa0916ee2cf99cee66c0b685`；本地分支 `codex/aivora-product-local-20261011`。参考分支在本批提交前只读核对仍为精确总基线。没有改main、推送、合并或触发远端CI。

## 实际闭环与边界

新增只读 `GET /api/v1/projects/{project_id}/episodes/{episode_id}/media-assembly/versions/{version_id}/readiness`，必须同时提交原保存 `expected_content_hash`。生产装配、Voice和导出共用 `AssemblyReadinessPanel`、真实桌面固定IPC、preload、transport和API；不新增业务表、操作日志或第二套装配。导出入口显式读取本集保存头，装配/Voice使用当前已保存版本，不采纳未保存编辑。读失败保留已有精确选择；A→B→A及正文hash核对期间的旧响应被丢弃。只读核对不解除UNKNOWN、未应用裁剪/字幕或原保存保护，不自动读取后批准、保存或执行。

后端在同一 `query_only / BEGIN` 连接读取历史装配，原 `read_version` 历史语义保留；新鲜来源核对与历史回读分开。完整递归正文/元数据/probe/权利物化使用有界预算，SQL长度/数量检查先于JSON物化。直接原件、手工候选与G5引用通过显式ContextVar scope共用32MiB散列预算；稳定已核实原件可复用，仍重查受管路径和含ctime的stat身份，失败不退预算，nested不重置，finally清理。无scope的旧路径仍保留每原件32MiB行为，未改DRAFT常量或安全门。

实际核对保存头、CONFIRMED剧本来源、每画面片段的分镜/G5/手工候选来源、当前原件字节和权利、既有视频/音频probe与音频源采样范围。DRAFT或没有正式pin的来源保持NOT_BOUND；同源重复确认或较新未确认草稿不假失效。字幕/对白的保存范围和精确来源完整返回，缺声音、字幕内容、口型人工审核以及母版证据仍阻断。不会新探测、播放、编码或生成媒体。

所有观察固定 `NO_PICTURE_LOCK / NO_EXPORT_CLAIM / BLOCKED`。既有 `_APPROVED_RELEASE_PROFILES` 空集、G1/G2/G5与正式预检阻断均保留。新页面展示的是前置事实和缺项，不是PictureLock、专业声音/字幕审核、G7B/G7C/G8或完整正式导出。观察时间不是将来执行的授权token，后续实际操作仍需重新核验。

装配/Voice的确认替代历史改为读取作品全部来源分集，显式详情在完整assessment hash核对后，按目标 `episode_id / version_id / content_hash / artifact_type` 标记本集精确保存装配。原其他版本、全影响理由、声音/字幕帧和原引用完整保留。旧source-episode过滤在其他入口保留；不再误把来源分集当作受影响装配分集。缺匹配报告和迁移前缺快照都不能作为审核通过。未回填旧事件或声称影响历史已经穷尽。

## 受影响验证与原问题

统一最终25源/测试/配置/生成合同freeze SHA256 `901ad20b15648310664ff908147b60b91b64db778183ebb54819004fd4dc5030`，全部尺寸与SHA核对。根最终新增renderer19、desktop21通过；旧renderer111、desktop3由本批已执行且未失效的受影响检查复用，合计130 renderer、24 desktop，不重复累计迭代重放。两份真实认证应用GET的完整原JSON和响应header，经实际desktop client再进入生产renderer，另2跨层控制通过；这是in-process TestClient＋受控传输/DOM，不是Windows实机或真实网络验收。

后端新增27个不同pytest控制通过；旧reader18与原件边界44有13个相同nodeid，旧union49通过，因此Python为76个不同用例。HTTP测试最终移除fallback并要求实际应用OpenAPI包含路由，该一个修改后控制重放，其余未失效26复用。两份额外HTTP捕获不加pytest数量。实现者验证与独立审查分列，不把自己实现称独立批准。

根全仓TS typecheck及284源strict mypy通过；25源范围ESLint/Ruff/Prettier/格式检查通过；正常合同生成成功，提交后的正常contracts:check另存交付回执。未扩大到无关全量coverage、构建或安装；原安全审计、CI、授权/许可、覆盖门及旧失败没有降低或删除。

独立审查初期发现并实修：String转换错误接受数组枚举；Date.parse把不存在日期归一化；desktop仅核对hash字段未重算正文；素材证据集合缺失或错配仍被接受。最终shared guard严格闭合枚举/UTC日历、完整装配观测与每个实际媒体ref集合；desktop和renderer分别重算canonical SHA。实际客户端新GET有专用4,250,000B上限。独立最终16个生产控制通过（原15＋响应长度delta），固定IPC授权在选择client之前，真实main拒绝foreign/null/subframe/detached/destroyed；preload→transport→registrar→client精确GET转发、异步hash ABA、未保存输入与影响目标也覆盖。该16单列，不加根154或Python76。

所有已保存stdout/argv/UTC/exit、初始4fail/随后2fail、测试夹具参数/注册断言错误与runner诊断保留。根初期未自动保存stdout的工具回执只在 `ROOT_PRELIMINARY_DIAGNOSTICS.md`说明，不重构成原日志。跨层首次漏传合成sidecar session造成两个harness失败，补测试session后两个通过；配置warnings原样保留，未隐藏。后端6源final seal、27/49 nodeid去重证明和456成员owned SQLite/自有PNG/WAV夹具ZIP逐SHA保留；fixture准备和只读GET区分，不称用户工作区或真实质量验收。

## 交付增长核对和原件修正

独立固定34审计：源码净增35,661B、非evidence文档净增18,699B、evidence新增278,676,037B；不能把6个变更源文件73,518B当净增长。最大两目录为549 tracked浏览器证据145,675,837B、1582实现证据129,691,425B。同Git内容958个唯一对象/134,474,379B，重复路径144,201,658B；六份已有字体副本100,318,836B，未增加新生产字体。三套完整恢复补丁重复序列化进一步放大原33的24卷193,626,373B到34的86卷711,832,518B。

所查Git路径、7 tracked ZIP和外部33/34共110卷未发现旧恢复树/包、依赖、cache递归混入。原截图、SQL库、sidecars、失败和全源码快照不是无关残留，均保留。没有采纳历史归档排除或未批准Linux ABA候选。仅对新交付使用完整历史内容引用/CAS去重，旧提交、旧24/86包和全部旧seal不重写。

发现34浏览器复制550文件但Git仅549：39B `final-browser-ux/VITE_FINAL4_DEV.log`被既有 `.gitignore:18 *.log`忽略。原SHA `afe934209b16e0a317138080424166b6b68111a86752fe907b08ba210aeb96e2`与旧封存一致。本35只显式force-add原字节，不改ignore或34提交/封存。34原恢复包确实没有该39B；35新Git树/交付补齐，不能追称旧34包已经包含。

固定34-v3轻量源码投影1,342,205B，SHA `ed382ff68cc45940cbdc75140d6919360f3234b0e0c52e46bfef7adbe74b5bc1`，累计432个非evidence路径，可独立应用到精确干净基线，不需86卷。独立完整历史证据CAS为21卷，每卷<10MB，35快照/26,644路径引用/3190唯一blob；实际owned源应用、dirty/wrongbase拒绝、默认不写和完整组合6422变更SHA/8718文件/tree `7ee108f7aae813fb9223ee122204c473ec36282e`验证通过。保留首版PowerShell EOL误拒失败、v2和v3修正验证，不假称Windows执行。

本批提交后以精确新SHA复用同一脚本制作35源码投影和独立历史CAS，另保留单批完整Git format-patch，旧34的86历史卷可真实续接。源码投影、完整目标文件树、真实Git提交/祖先图口径分开。小脚本/报告/哈希证明入本批；大包与owned恢复工作树留独立scratch交付，不递归复制进repo。最终路径/尺寸/SHA与实际恢复证明在提交后的交付清单，不能将本地路径称可下载链接。

## 继续实施和实测依赖

23页/五阶段、普通专业同质量数据权限、DRAFT32视觉32音频/30分钟/1920与原件界限保持。原始Word未逐页核对，不称全历史需求穷尽。较大布局A/B和正式媒体/Voice协议缺口已交父；父尚未向用户提问，不存在用户欠答。预算仍是作品/分集额度关系及确定超额行为两问；没有代选币种、账号或付费供应商。零外呼的来源合同、不可变人工检查草稿和缺项观察仍可继续工程实施，不把预算未知当全部工程停止理由。

后续需真实媒体与合法声线/克隆范围、VoicePlan/精确读本与试听修订、音帧对齐和口型、声音/字幕人工检查证据、SoundSpotting/CueSheet/MixMaster、G7B/G7C/G8及完整输出规格/原生准入。不能用前置只读PASS或新增勾选绕过授权、质量与安全门。Windows窗口/实际播放/DPI/键盘、安装升级恢复及真实模型质量均待电脑恢复；同步前检查未提交内容，任何重启仍先确认用户已保存。

无真实模型/图像/视频/语音、费用、凭据输入、Provider调用、用户账号/电脑操作；UNKNOWN没有自动重发。Library正式工具未获恢复证据，31–35没有新的正式保存尝试，也未绕过网络/工具拒绝。最新用户确认下载仍27，28为历史正式保存且未获用户确认；本地源码/CAS不能冒充正式下载。
