# 两首音乐的接缝试听

`happy-life-seam.wav` 对应快乐生活（长循环）；`illusionist-seam.wav` 对应幻术师（长循环）。每条10秒：最终Ogg的尾部5秒直接接开头5秒，接缝在第5秒，没有新增淡化、限幅或响度处理。48kHz、双声道、24位PCM WAV，供用户检查节拍和乐句；不计入素材manifest，不作为新曲目。

来源文件与试听文件哈希、格式验证见PREVIEWS.json。没有作主观错拍判断。

重建：`python export.py --ffmpeg /usr/bin/ffmpeg --ffprobe /usr/bin/ffprobe`。工具须显式绝对路径，支持中文和空格。
