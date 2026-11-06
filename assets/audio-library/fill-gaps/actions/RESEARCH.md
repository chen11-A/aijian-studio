# 未收录动作素材研究记录

本记录仅保存本轮已经取得的证据，不新增音频，不把候选计入素材数量，也未重复访问失败原页。网页工具返回的 Internal Error 不能直接解释成授权拒绝；无法核验时停止该目标，不更换路线。

## 钢管落地：许可可核实，音频获取链未完成

以下原作者页面的正常网页检索结果均明确 Creative Commons 0，描述为铁管落在大房间的混凝土地面，以 Zoom H4 和 Rode NT4 立体声录制。

| 原作者页面 | 原始标题 | 原始时长与格式 | 本轮结论 |
|---|---|---|---|
| https://freesound.org/people/RutgerMuller/sounds/104353/ | Thin Metal Pipe Falling on Concrete in Basement.aif | 2.500秒，48kHz，16bit立体声 | 未找到可获取且对应此编号的 GitHub 音频镜像，未收录。 |
| https://freesound.org/people/RutgerMuller/sounds/104354/ | Metal Pipe Falling on Concrete in Basement 2.aif | 2.488秒，44.1kHz，16bit立体声 | 同上。 |
| https://freesound.org/people/RutgerMuller/sounds/104355/ | Metal Pipe Falling on Concrete in Basement.aif | 6.487秒，44.1kHz，16bit立体声 | 同上。 |

这些是铁管落地，不能标成钢管拖地。VocalImitationSet 文件树也未包含以上三个编号。1noxaj 的586114页面虽标CC0，但没有完成可信镜像对应及原录音来源核验，未收录；未使用任意同名网络梗音补足。

## 人体倒混凝土：原作者页面未完成核验

候选是 mlsulli 的 Body Hits_Concrete.wav，编号234853。ArmorAlley 固定提交 `20ffcb8ff05218f79acc568e3d2d3ea45c52227f` 的 README 与五个拆分 WAV 提供了第三方对应关系，但不替代原作者许可。

该原页唯一访问的工具类别及原始错误文字为：

```text
Internal Error ()
URL https://freesound.org/people/mlsulli/sounds/234853/ is not accessible via this tool.
```

未重试该页面。作者个人主页可正常访问，但未发现覆盖此文件的统一 CC0 声明。因此五个音频均未收录。

## VocalImitationSet 八个候选的筛选结果

检查的仓库为 `interactiveaudiolab/VocalImitationSet`，固定提交 `b77114c43c52f5faa7d0bb69b22e1ebca0632201`。仅从 `original_recordings/non_reference` 的真实原录音文件名寻找候选，没有使用 `vocal_imitations` 中的人声模仿。

| 候选原页 | 已取得结果 | 决定 |
|---|---|---|
| https://freesound.org/people/jesabat/sounds/119737/ | 正常可读，标题 Metal Scrape.wav，许可 Attribution 3.0；描述只说明金属刮擦。 | CC BY不符合CC0要求，且没有钢管语义，排除。 |
| https://freesound.org/people/claire-h/sounds/182348/ | Internal Error；URL is not accessible via this tool。 | 未核实原许可与具体动作，未收录。 |
| https://freesound.org/people/bmaczero/sounds/96137/ | 同上。 | 同上。 |
| https://freesound.org/people/korgchops/sounds/170633/ | 同上。 | 同上。 |
| https://freesound.org/people/otisjames/sounds/215162/ | 同上。 | 同上。 |
| https://freesound.org/people/theshaggyfreak/sounds/274942/ | 同上。 | 同上。 |
| https://freesound.org/people/reitanna/sounds/332668/ | 同上。 | 同上。 |
| https://freesound.org/people/adam-n/sounds/164219/ | 同上。 | 同上。 |

七个失败目标均未改 URL 或改路线重试。文件名中的 thud、clunky-metal 或 metal-scrape 不能证明是人体倒水泥或钢管动作，本轮没有根据这些泛称改标签充数。
