# 3JR 多角色配音接口交接

代码：B01 f38e091；B05 ed2f855、0dd16fc。没有修改Claude渲染或样式。

- 生成请求shots[].lines：`{speaker:string,text:string,voice_id?:string}[]`；web实际每句显式选声。多角色任一句缺声音拒绝，禁止用全局voice_id覆盖全部人物。每句声音1–64字符、无空白/控制字符。
- 会员服务逐句合成，按顺序接一条wav。合并音轨使用原来的`voice_path`，因此时间线仍以镜头为一条配音，不显示伪造的逐句时间标记。逐句可编辑波形不是本轮实现。
- `FilmTake.durationSeconds?:number`是实际成片长度，可超过15秒（配音长时本地延长末帧）；15秒只限制供应商视频请求。已完成选定版本的长度在工程读回保留。
- `FilmCharacter.voiceDefault?:{basis:"adult-default",evidenceSource:"source"|"character-reply"|"casting-default",evidence:string}`。年龄未知仍`ageBand:""`；casting-default是可调整临时声音，不能在界面显示成“原文是中年”。明确年龄优先，用户手选声音保持。
- `MULTI_VOICE_PROVIDER_REQUIRED`兜底“分角色配音需要 Grok 会员。”需追加最终NOTICE_COPY，不能静默绕过完整性检查。

已有回归：Python服务produce真实本地FFmpeg端到端（TTS替身）证明声音顺序、完整长度、字幕与voice_path；桌面协议和web压缩/时间线/存盘分别覆盖对应边界。真实会员、实际工程19/21镜及主观声音效果仍待验。
