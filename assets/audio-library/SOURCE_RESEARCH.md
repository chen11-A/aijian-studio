# 补充素材来源研究

本记录只列出未收录候选的研究结果，不代表最终交付数量。另一路研究已收录原作者 CC0 的手机震动和车辆音效；最终完成情况见本目录 README.md。

当前云端 HTTP 允许列表包含 GitHub 及其文件域名，不含 Freesound、OpenGameArt、Wikimedia。未尝试绕过该限制，未把第三方仓库对许可证的转述当作原始页面核验完成。以下是已找到的候选及排除原因，不是可收录清单。

| 候选 | 能取得的材料 | 原始证据或内容不足 |
|---|---|---|
| [BrenoBertucci/Terrarium](https://github.com/BrenoBertucci/Terrarium/blob/main/assets/audio/CREDITS.md) | GitHub 音频及逐文件来源表，含虫鸣、森林、波浪、人声底噪 | 作者是使用者；原始授权页面在 OpenGameArt、Freesound 或 Wikimedia。本轮未独立核实原始页面；其中 waves 明确来自河浪，不能改称海浪。 |
| [dgreenheck/tidewater](https://github.com/dgreenheck/tidewater/blob/main/public/audio/CREDITS.md) | 42 条实录加工文件，含海浪、虫鸣、林鸟和船发动机；本地下载成功 | CC0 标记来自第三方 credits，原授权在 Freesound。本轮不能把镜像声明当作原作者授权页面证据；若后续验证仍须保留其切片、交叉淡化和再编码记录。 |
| [akumar94/painted-lineage](https://github.com/akumar94/painted-lineage/blob/main/CREDITS.md) | 多个人群、车辆音频及 Freesound 来源编号，本地下载成功 | 原始 Freesound 授权未完成独立核验；仓库还混有 ElevenLabs 生成音效，不能整库按 CC0 收录。 |
| [jaimebg/Ambio](https://github.com/jaimebg/Ambio/blob/main/ATTRIBUTION.md) | 配乐应用的来源说明 | 项目 README 自述部分旧音频原始来源无法恢复；不使用“全部 CC0”的概述替代逐文件原始证据。 |
| [OpenTTD/OpenSFX](https://github.com/OpenTTD/OpenSFX/blob/master/src/opensfx.psfo) | 车辆等 WAV、逐文件许可证映射，本地下载成功 | CC0 与 CC BY／CC BY-SA 混合。虽有部分车辆条目标 CC0，原录音授权仍需核查；未整包收录。 |
| [Team-Immersive-Intelligence/SoundDepot](https://github.com/Team-Immersive-Intelligence/SoundDepot) | 原贡献者元数据、录音、逐条 CC0 授权 | 现有灯具、锤子、电动扳手等，不属于本次缺失类别。 |
| [code4fukui/sound-cc0](https://github.com/code4fukui/sound-cc0/blob/main/sounds.csv) | 原发布仓库逐文件 CC0 清单 | 主要是爆竹、笑声、金属、开关等；不能冒充目标类别。 |

## 国家公园管理局候选：授权声明已核实，但未收录

官方仓库固定提交：[nationalparkservice/acoustic_discovery@512a3c6c471e8844a45d64a92258cb8798fae2b2](https://github.com/nationalparkservice/acoustic_discovery/tree/512a3c6c471e8844a45d64a92258cb8798fae2b2)。

- [官方 README 的 Public domain 段落](https://github.com/nationalparkservice/acoustic_discovery/blob/512a3c6c471e8844a45d64a92258cb8798fae2b2/README.md#public-domain) 明确声明整个项目在美国为公有领域，全球权利通过 CC0 放弃；未发现音频排除条款，也未发现逐音频额外授权文本。
- 实际 `LICENSE.txt` 只有 `TODO`。README 链接的 `LICENSE.md`、`CONTRIBUTING.md` 不在该提交，不能声称取得了这两个文件。
- [test/SWTH_test_30s.wav](https://github.com/nationalparkservice/acoustic_discovery/blob/512a3c6c471e8844a45d64a92258cb8798fae2b2/test/SWTH_test_30s.wav) 已下载，ffprobe 实测 30.5 秒、44.1kHz、单声道 PCM。SHA-256：`9784663a7c0486a8c292f7bb8e9c88ee2a98f662831e4d7bb4b4f4760132e8b6`。
- 官方示例称这是斯氏鸫鸣声（Swainson’s Thrush songs）测试音频，不能据此确认是完整森林环境。另两个 MP3 是同一段录音的转码，不是不同素材。未把同一鸟声裁成三段充作三个森林环境素材。

本候选研究中的雨伞、钥匙没有找到同时满足“原作者 CC0／公有领域证据、实际可下载、内容准确”的新增候选。未使用 CC BY、Pixabay 或无法追溯来源的文件替代；最终交付另有明确标注的自制及第三方 CC0 合成音效。

继续补齐需要能够核验原始授权页面及获得对应原始音频，或提供自带原作者授权声明的合法素材包。候选镜像不是已完成授权核验的交付物。

钥匙候选的确切受阻操作：读取原作者许可页面 `https://opengameart.org/content/100-cc0-metal-and-wood-sfx` 时，网页工具返回 `restricted URL`。未改用其他线路读取该受限页面，也未把已取得的镜像音频加入清单。这是访问限制，不是已证实该素材许可不合格。
