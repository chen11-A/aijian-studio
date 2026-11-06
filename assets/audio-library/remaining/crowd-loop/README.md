# 会议厅真实人群循环

四条均由已核实CC0的jentlemen原作432331制作。原始录音57.393秒，镜像MP3为57.432秒，不能提供三条互不重叠且各30秒的内容。

前三条从镜像0–18、19–37、38–56秒取材，区间互不重叠，各经1秒尾首等功率交叉淡化得到17秒循环。第四条取0–56秒，制成55秒长循环；它与前三条有重叠，同源派生不算新原始录音。全部保留真实会议厅声音，不充当医院环境。

编码后逐声道接缝检验全部通过，报告在同名JSON中；48kHz单声道Vorbis，loop及loopable均true。响度依次-20.68、-20.33、-21.75、-21.89 LUFS，真峰值最高-1.72 dBTP。固定增益优先保留瞬态并限制峰值，后两条以peakLimited标出响度偏差。尚未人工试听，不声称听感审查已完成。

来源、原页CC0许可及固定镜像提交见licenses/crowd.md与entries.json。镜像HTML的AMBIENCE.crowd为音频base64；复用其已取得文件，无需再次请求原站。

离线重建需Python及numpy，复用库内round2-loops/build_loops.py的实际交叉淡化、边界旋转及解码后接缝检测：

```sh
python prepare.py --ffmpeg /绝对路径/ffmpeg --ffprobe /绝对路径/ffprobe --crowd "/原始素材/会议厅.mp3"
```

工具路径显式传入，支持空格中文；输出四条音频、报告和entries.json，不修改主manifest。
