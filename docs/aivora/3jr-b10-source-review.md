# 3JR-B10 原文来源核对

## 实际输入与限制

仓库提供的 `packages/aivora-prompts/fixtures/test-novel-2000.txt` 第51行明确写有“沈砚开着书店那辆旧面包车，一路跟了过来。”；SHA-256为 `acaba10e8752d4730be1391682a3bbc77e6fd37308e545303dba951c28f31b9e`。原文没有“面包车停在仓库外”这句话。因此不能将车辆本身判为凭空出现；待核对的是额外停车情节及其插入打斗的时序。尚缺本轮实测的完整导演回复与project.json，未声称复现会员输出。

## 已提供的后端接口

- 导演提示词版本4要求以原文为事件事实来源；出现过人物或道具不授权新增相关事件，先前到达、停车不能在打斗中重演。限制覆盖picture、action、首帧和视频描述。
- `inspectDirectorSources(scene, shots)`只检查明确的来源段号。`source-missing`、`source-unknown`、`source-out-of-order`、`source-unavailable`均返回`needs_review`，不按镜头位置猜出处。
- `FilmShot.sourceReview = {evidence:"declared-paragraph-order", status:"ordered"|"needs_review", hints, issues}`保存解析完成时的审查。flat/wrapped回复都在合镜完成后统一审查；不会为了修复倒序而删除或重排内容。
- `ordered`只表示模型声明的段号顺序可成立，不是情节语义已经核实。段号存在同样不能证明画面所述事件来自那一段。
- 已有`sourceReview`的镜头在`applyContinuityChecks`中按当前场景再检查，通过C13的`cut`提醒显示“原文出处还需核对”或“引用了前面已经拍过的原文”。这个重新检查的提醒可以反映后续改稿；持久化的`sourceReview`仍是解析时记录。没有该字段的历史镜头不被强制判错。
- 没有新增checkpoint硬阻挡或自动消除幻觉功能；不能用纯段号检查替代用户/模型对实际情节的核对。

## 验证

本地Web36项通过，覆盖明确来源倒退、未知/缺失段号、同段多镜、同镜多段、flat/wrapped真实解析入口、保存/读回/hydrate、C13提醒及旧存档兼容。Python12项通过，覆盖提示词版本与规则、真实测试小说内容。日志为`/workspace/3jr-b10-boundary-tests.log`和`/workspace/3jr-b10-python-tests.log`。均未调用供应商；完整“不会新增情节”的真实会员验收仍未完成。
