# 自动粗剪

输入镜头 `id`、时长 `duration`、逐字时间戳 `words`、动作节点 `actionNodes`，所有时间单位为素材内秒数。输出 `inPoint`、`outPoint`、保留时长 `duration`，及入点、出点中文理由 `inReason` 和 `outReason`。只输出剪辑决策，不修改媒体。

```ts
import { roughCut } from './index.js';
const cuts = roughCut([{ id: '镜头一', duration: 8,
  words: [{ text: '你', start: 2, end: 2.2 }, { text: '好', start: 2.2, end: 2.5 }],
  actionNodes: [3],
}]);
// 入点 1.7，出点 3.45，保留全部台词和动作。
```

默认前留 0.3 秒，后留 0.45 秒。第二参数可传 `{ beforeDialogue: 0.2, afterDialogue: 0.6 }`，范围分别限定为 0.2～0.4 和 0.3～0.6 秒。无台词镜头按最早/最晚动作节点剪；没有任何标记则保留完整素材。素材边界不足以留白时不制造不存在的画面，理由中提示补充素材。

有台词镜头同时保留全部动作，因此留白以最早/最晚内容为边界。每个镜头输出一个连续片段，不删除台词内部停顿、不重排镜头。无效时间、越界节点和重复编号均报中文错误；不修改输入。

测试：上级目录运行 `npm test -- rough-cut`。
