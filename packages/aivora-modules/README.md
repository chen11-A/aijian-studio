# AIVORA 本地独立模块

本目录是独立的 TypeScript 包，使用 Node.js 20 或更新版本。没有接入现有界面，也没有修改仓库根依赖、现有源码或 CI。运行时不调用模型、付费服务或网络接口。

## 安装和验证

```sh
cd packages/aivora-modules
npm ci
npm test
npm run typecheck
```

`npm test` 使用 Vitest 和 V8 覆盖率，要求每个源文件的行、语句、函数和分支覆盖率均达到 85%。测试报告输出到 `coverage/`，该目录不提交。首次安装开发依赖需要 npm 仓库；业务处理全部在本地执行。

涉及媒体的模块必须由调用方传入 ffmpeg/ffprobe 可执行文件的完整路径，不从 PATH 搜索。集成测试在 Linux 使用 `/usr/bin/ffmpeg`、`/usr/bin/ffprobe`，可按各模块说明传入本机路径。中文字体引用现有仓库文件，不在仓库新增或修改字体；封面渲染使用的临时副本结束后删除。媒体输出应写入调用方指定的工作目录。

## 模块

| 目录 | 输入 | 输出 |
| --- | --- | --- |
| [audio-library](audio-library/README.md) | 素材库目录与清单 | 校验后的本地素材对象 |
| [audio-picker](audio-picker/README.md) | 素材清单、场景、镜头和动作时间 | 配乐、环境音、音效及压低音量计划 |
| [subtitles](subtitles/README.md) | 台词文本、说话人、起止时间 | SRT、ASS 和烧录参数 |
| [export-check](export-check/README.md) | 时间线和本地媒体文件 | 带镜头编号、时间和修改建议的中文问题 |
| [loudness](loudness/README.md) | 成片、目标响度 | 两遍 loudnorm 处理后的成片及测量 |
| [cover-title](cover-title/README.md) | 画面、片名、副标题、集数 | 三种尺寸封面和三秒片头 |
| [project-archive](project-archive/README.md) | 作品目录或 .aivora 文件 | ZIP 备份、SHA-256 清单和完整性验证后的作品 |
| [rough-cut](rough-cut/README.md) | 镜头时长、逐字时间、动作节点 | 入点、出点及中文理由 |

素材库位于 [`../../assets/audio-library`](../../assets/audio-library)。每个模块的具体类型、用法和限制见对应中文说明。所有时间单位均为秒，字幕文件内部按各自标准格式序列化时间。
