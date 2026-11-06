# 剩余环境音补充

本目录新增3条真实夜街环境循环，各39秒，来自Romano.Tercero的同一CC0现场原作不同片段。三个原始40秒片段不重叠；不是三个独立来源。使用1秒尾首等功率交叉淡化，再旋转边界到稳定非静音窗口。没有首尾分别淡到静音冒充循环。

成品48kHz单声道Ogg；编码后重新解码，逐声道接缝样本跳变与局部能量检查全部通过，详见每条同名JSON报告，loop=true。实际响度依次为-21.13、-19.88、-26.72 LUFS，真峰值最高-1.92 dBTP。第一、三条为保留真实瞬态并满足峰值上限，采用固定增益而低于-20 LUFS目标，清单标明peakLimited；未声称响度完全一致。客观检查通过，仍未人工试听。

输入：从entries.json固定提交downloadSource取得street_level.mp3。
输出：3个Ogg和entries.json，不修改全库manifest。

```sh
python prepare.py --ffmpeg /工具/ffmpeg --ffprobe /工具/ffprobe --night "/本地素材/夜晚街道.mp3"
```

需要numpy，复用库内round2-loops/build_loops.py的交叉淡化、接缝检查函数。脚本仅本地处理，所有工具使用参数传入的绝对路径。原作者CC0页面和镜像同次提交对应依据见licenses/puebla.md及mirror-credit-commit.txt。镜像为136.056秒节选，原始504.384秒录音中的裁剪起点未知，未声称直接下载原WAV或进行原WAV哈希匹配。

医院走廊仍未取得可验证且可下载的合格文件。此前已核实BigSoundBank0874真实产科走廊但命令行403、域不在白名单，本轮未重试；Freesound bassboybg医院候诊室虽已核CC0，论文Wheeze_Counter只有叠加病患呼吸的版本，未提取。继续检索医院走廊新GitHub来源未找到合格音频，未用通用房间底噪或候诊室代替走廊。
