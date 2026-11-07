# 自动前置图执行上下文：消费者阶段记录

本片基38fe6a1，真实合入0cc0dde的prepare/retire中立合同和2df3d4a的共享输入纯提取；未复制backend的native/API54 WIP，尚未代表该保护闭环交付。原89e303c检查点保留。

普通流程沿原数量/费用确认、canonical历史捕获后、分配新queued take前prepare；原模型body/第三localScope不变，自动图第五参、视频第四参只带native已发issued定位符。scene locations与portrait角度按实际canonical ID/view定位，不解析prompt或产生renderer失败digest。所有handle仅内存，不进作品/历史/ZIP。缺prepare或retire能力时零自动图/视频，不降级旧四参路径；独立手工出图保持原分支。

Pipeline按完整有序filmPipelineTargets(video)请求，PREPARED仅允许native核定的有序非空子集和准确槽数；renderer不以path存在自行筛掉镜头。工作区第一次实际自动媒体前短prepare，同一session贯穿location/portrait/front-anchor/shot-frame/video；取消/换作品/账号事件立刻退执行，单TaskCenter取消按真实take映到issued slot，只先退这一个slot。RETIRED不表示HTTP已停或未知已核销。

实际取消区分：queued单项取消沿原skip再下一项；running awaitVideoResult取消沿原退出/暂停，余queued全文保留给原恢复入口，当前ordinary finally退执行属于生命周期清理，不自动续跑。候选“running后自动continue”的测试失败已保留在`/tmp/generation-execution-single-cancel-before.log`，按原业务永久断言修正，无相应产品续跑改动。

阶段证据：原core3文件43过；补protected pipeline默认能力/缺桥负例后2文件24过；actualPro3+core43+pipeline24联合6文件70过（`/tmp/generation-execution-joint-stage.log`）。后来actualPro新增TaskCenter单slot即时退/余queued保留，与原run新增取消双侧共2文件36过（`/tmp/generation-execution-cancel-after.log`）；它们有重叠，不能相加。阶段正式web类型和目标静态0见`/tmp/generation-execution-checkpoint-{types,eslint}.log`，不是最终联合验收。

未解/待合同：protected cache preparation/continuity local-stage真实契约待backend checkpoint，native/API54消费者尚未冻结。原pipeline顺序writer→art→portraits→director；fresh无shots时第一个portrait前完整video scope为空，现严格失败关闭，已向总控/后端报告，不自行重排步骤/造未来shot/借估计数或空scope派发。最终需真实native及实际Pro跨层、旧生成/pipeline/保存/历史/取消兼容与正常Chrome新门，当前合成ABI不能证明原子父预算、文件可信性或付费实际结果。
