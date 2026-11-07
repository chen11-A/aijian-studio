# 自动前置图执行上下文：消费者阶段记录

本片基38fe6a1，真实合入0cc0dde的prepare/retire中立合同和2df3d4a的共享输入纯提取；未复制backend的native/API54 WIP，尚未代表该保护闭环交付。原89e303c检查点保留。

普通流程沿原数量/费用确认、canonical历史捕获后、分配新queued take前prepare；原模型body/第三localScope不变，自动图第五参、视频第四参只带native已发issued定位符。scene locations与portrait角度按实际canonical ID/view定位，不解析prompt或产生renderer失败digest。所有handle仅内存，不进作品/历史/ZIP。缺prepare或retire能力时零自动图/视频，不降级旧四参路径；独立手工出图保持原分支。

Pipeline按完整有序filmPipelineTargets(video)请求，PREPARED仅允许native核定的有序非空子集和准确槽数；renderer不以path存在自行筛掉镜头。工作区第一次实际自动媒体前短prepare，同一session贯穿location/portrait/front-anchor/shot-frame/video；取消/换作品/账号事件立刻退执行，单TaskCenter取消按真实take映到issued slot，只先退这一个slot。RETIRED不表示HTTP已停或未知已核销。

实际取消区分：queued单项取消沿原skip再下一项；running awaitVideoResult取消沿原退出/暂停，余queued全文保留给原恢复入口，当前ordinary finally退执行属于生命周期清理，不自动续跑。候选“running后自动continue”的测试失败已保留在`/tmp/generation-execution-single-cancel-before.log`，按原业务永久断言修正，无相应产品续跑改动。

阶段证据：原core3文件43过；补protected pipeline默认能力/缺桥负例后2文件24过；actualPro3+core43+pipeline24联合6文件70过（`/tmp/generation-execution-joint-stage.log`）。后来actualPro新增TaskCenter单slot即时退/余queued保留，与原run新增取消双侧共2文件36过（`/tmp/generation-execution-cancel-after.log`）；它们有重叠，不能相加。阶段正式web类型和目标静态0见`/tmp/generation-execution-checkpoint-{types,eslint}.log`，不是最终联合验收。

未解/待合同：protected cache preparation/continuity local-stage真实契约待backend checkpoint，native/API54消费者尚未冻结。原pipeline顺序writer→art→portraits→director；fresh无shots时第一个portrait前完整video scope为空，现严格失败关闭，已向总控/后端报告，不自行重排步骤/造未来shot/借估计数或空scope派发。最终需真实native及实际Pro跨层、旧生成/pipeline/保存/历史/取消兼容与正常Chrome新门，当前合成ABI不能证明原子父预算、文件可信性或付费实际结果。

## fresh/缓存/未知的可审检查点

真实再合6385bb5/b8e03de合同：每target必有`preparation`，只有native明确`STORYFILM_CACHE`才跳client images；缺stage不能推成缓存。`continuity-frame`按后镜与真实紧邻前镜ID精确定位，protected调用即使旧continuityFrame字段吻合也重新走第三参native本地校验；无新provider取帧。固定still code/传输未知品牌化穿透旧portrait/location retry；返回已有path同时WRITE_UNCONFIRMED也不采用为可继续首帧，原私有文件不删除，不宣称0POST/没图片或即时重做。普通非protected已知失败的原一次retry保留。

执行依赖仅controller指定writer/art→director/action/performance/prompter→首媒体数量/会员确认→portraits/stills→原review/video/assembly；schemaVersion1存储steps数组及旧done/queued事实未改。首媒体确认不设continued；后续人工review和video继续仍独立。完整实际shot scope的视频数量为上界，不能把纯path筛得的estimatedRequests=0当缺文件新增请求许可。一次性重试intent仅内存绑定project/fingerprint/checkpoint，真实“重试→首媒体确认→继续”保留原唯一target，不给兄弟失败项授权；改稿/跨工程/新run失效。

实际Pro fresh空shots正例：受控文字agent返回真实结构后才显示首媒体确认，默认0prepare/0图/0video；点击真实“继续生成”才用canonical完整非空scope prepare并写两张前置图，随后停原review needs-input且continued=false、0video。保其他消费者不变，仅暂换回HEAD原controller的同一测试before失败（无可继续首媒体确认），恢复文件逐字核同；`/tmp/generation-execution-fresh-pro-before.log`→`/tmp/generation-execution-fresh-pro-first.log`。这是合成ABI/受控文字agent的Pro/队列/UI证据，不是主进程原子预算或Grok实费证明。

最终此检查点定向15文件306项0：`/tmp/generation-execution-fresh-checkpoint-joint-final.log`（9.56秒）。最后只把issued image/local-stage失效也品牌化阻止旧retry，独立core10再过`/tmp/generation-execution-stage-failure-after.log`，不与306相加。正式web类型阶段0、目标ESLint/Prettier/diff0；旧Pro139/其余生成宿主尚待全部补真实新能力后联合，不能用306称整库通过。

仍非最终冻结交付：backend API54/ledger/plan/source/client/lineage尚在收尾。我下一步拥有native registry/IPC/preload/main/film-library sink hooks，等待真实helper checkpoint合入；不复制WIP/HTTP协议、prompt、源验证。正常Chrome新UI16的后续两处测试消费者失败由另一QA分支独立处理，本树在该叶期间保检查点。

## Original PipelineWorkspace integration migration

The original three real-Pro integration cases previously had no prepare/retire bridge and jumped from one-click directly to review. They now use the actual protected ABI: the first media checkpoint has zero prepare/still/video calls, shows the complete video upper bound and requires a real Continue click. The preparation mock checks the current full raw hash, ordered shot/one-version scope and original backup; subsequent still/video calls must carry the issued execution context. Existing separate human review/video confirmation, history order, complete/partial assembly and no repeated assembly assertions remain. `/tmp/generation-execution-pipeline-host-joined.log` is 2 files/12 tests (original integration 3 plus generation execution 9); no timeout increase or product fallback. Formal web types and owned ESLint pass. This is controlled ABI evidence, not API54 native dispatch proof.
