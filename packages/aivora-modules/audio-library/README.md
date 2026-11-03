# 素材库读取与清单验证

`loadAudioLibrary(root): Promise<AudioAsset[]>` 从本地素材库根目录读取 `manifest.json`。输入是目录路径，输出与 `audio-picker` 共用的 `AudioAsset` 数组；数组中的音频路径仍相对于根目录。中文和空格路径可直接传入。

```ts
import { loadAudioLibrary } from './index.js';
import { pickAudio } from '../audio-picker/index.js';
const library = await loadAudioLibrary('/项目/assets/audio-library');
const result = pickAudio({ emotions: ['紧张'], description: '雨夜街道', duration: 5,
  shots: [{ duration: 5, hasDialogue: false, actions: [] }] }, library);
```

检查非空数组、必要字段类型、有效时长与响度数值、来源网页链接、CC0/公有领域许可证白名单、重复编号和文件路径、文件是否存在。拒绝绝对路径、父目录跳转、Windows 驱动器路径及符号链接指向库外；清单中的路径统一用 `/`，避免不同系统解析歧义。重复路径按大小写不敏感检查，便于 Windows 使用。

该模块只验证清单与文件边界，不能仅凭许可证字符串证明实际授权，也不解码音频。真实格式、声道、采样率、响度、素材数量及总大小请另外运行 `assets/audio-library/check.py`；来源授权证据见素材库 `LICENSES.md`。所有检查均为本地处理，不访问来源网址。

测试使用独立临时素材清单与文件，涵盖成功读取、错误类型、缺失字段、非法许可证、越界和损坏清单，不依赖素材下载进度。上级目录运行 `npm test -- audio-library`。
