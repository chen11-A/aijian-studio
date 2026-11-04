# 自制拟音：第三轮候选核验与配方

## 许可核验

本轮通过网页工具正常读取以下原页，没有用shell请求素材源域，也没有绕过此前受阻目标。

- [magnuswaker614064](https://freesound.org/people/magnuswaker/sounds/614064/)：CC0，1.327秒；作者说明可能源于重靴落下并调整低频，并非真实人体撞水泥。
- [SeanPorio519262](https://freesound.org/people/SeanPorio/sounds/519262/)：CC0，3.299秒；手/身体跌落撞击拟音，48kHz24bit立体声。
- [cinevid172413](https://freesound.org/people/cinevid/sounds/172413/)：CC0，15.265秒；混凝土与地毯上的四次摔落，原页未说明各动作对应地面，不能凭文件名把所有片段都归为水泥。
- [kyles451883](https://freesound.org/people/kyles/sounds/451883/)：CC0，205.284秒；蒙特利尔医院走廊交谈与轻微活动，48kHz24bit立体声，页面未见追加限制。

[tferrino618354](https://freesound.org/people/tferrino/sounds/618354/)、[618353](https://freesound.org/people/tferrino/sounds/618353/)、[640627](https://freesound.org/people/tferrino/sounds/640627/)的页面虽列CC0，同时在作者描述明确禁止将原音作为库存素材再次分发。三条均排除，不忽略这一冲突，也不通过剪切换名规避限制。

## 本地合成配方

只有确认下载受阻后才运行build.py作为用户授权的合成兜底；原页候选不是合成输出的音频来源，不得把它们填写成输出source。

人体倒地：70→40Hz快速下扫，振幅exp(-18t)；随机噪声exp(-25t)，低通2500Hz；30ms后叠加衣服摩擦，使用三个固定seed和不同配比。标为“自制人体倒地拟音”，不声称真实人体或水泥地实录。

医院走廊：粉红噪声高通60Hz、低通900Hz；120Hz正弦原始幅度-45dBFS；60/110ms短回声模拟走廊反射。三个固定seed，先生成41秒，再做1秒尾首等功率重叠得到40秒循环。不是用首尾淡到零伪装循环。此音效是自制通风/电气底噪，没有真实医院录音、人群对话或监护仪内容。

交付资产统一约-18LUFS且峰值≤-1dB。医院场景应由播放增益-12dB铺底（约-30LUFS）；资产响度不设检查器例外。最终Ogg解码后检查首尾跳变、相邻差分百分位与接缝RMS，不等同主观试听。

## 衣服摩擦成分

衣服输入不捆绑在此目录。必须从本地Git提交40049a9966298aae6c6058673abf945d48fba2b9的`assets/audio-library/sfx/sfx-4729d1a9a20d.ogg`导出后，通过必需参数`--cloth-input`传入绝对路径；脚本验证固定哈希。SHA-256：`3804ef7eac232c533128f53ada6b2035e37def0f1a0fe0ec19fda5176209c2e7`。

作者Kenney Vleugels，CC0-1.0；[固定来源cloth1.ogg](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds/blob/f2b6264f9ab89fabc266914c3654685d68c5a39b/kenney_rpgaudio/Audio/cloth1.ogg)。不读取正在批量修订中的当前素材文件。每个混合输出在components逐项记录原录音与生成成分。

## 自制内容许可

本目录新生成的合成波形及配方以CC0-1.0发布：https://creativecommons.org/publicdomain/zero/1.0/ 。衣服成分继承原作者CC0。不存在对候选Freesound录音重新授权；本目录未复制那些候选音频。输出名称带“自制”，origin为generated，recordingVerified为false。

## 实际下载阻碍

主任务统一验证新的Freesound页面628659时，代理CONNECT阶段返回403 Forbidden，未取得HTML。当前源域未放行，CDN也不在网络白名单且未取得可确认URL。未改路线或重试。按用户明确授权运行本地合成兜底；候选录音未下载。

第三种医院噪声的首次Ogg编码接缝跳变为相邻差分p99的1.057倍，未通过；保留同一循环内容，将起点循环平移0.5秒后重新编码并复测，未放宽阈值。

## 离线复现

先在仓库根目录导出固定版本衣服素材（不联网）：

```sh
git show 40049a9966298aae6c6058673abf945d48fba2b9:assets/audio-library/sfx/sfx-4729d1a9a20d.ogg > /tmp/aivora-cloth.ogg
python3 assets/audio-library/generated/round3-body-hospital/build.py --ffmpeg /usr/bin/ffmpeg --ffprobe /usr/bin/ffprobe --cloth-input /tmp/aivora-cloth.ogg --source-commit <包含此脚本的40位提交号>
```

`--source-commit`是必需参数，仅接受40位十六进制；应传入实际包含此脚本的提交。脚本据此生成固定GitHub源码链接，不猜测或虚构提交号。Windows调用时同样传入当地程序及输入的绝对路径，含空格的参数应加引号。
