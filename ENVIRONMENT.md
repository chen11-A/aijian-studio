# AI 漫剧工作台环境清单

配置日期：2026-08-03

## 已安装的基础环境

| 组件             | 版本             | 用途                    |
| ---------------- | ---------------- | ----------------------- |
| Git              | 2.53.0.windows.3 | 源码与版本管理          |
| Node.js          | 24.15.0          | Web、工作流与桌面端开发 |
| npm              | 11.12.1          | Node.js 自带包管理工具  |
| pnpm             | 11.9.0           | Monorepo 前端依赖管理   |
| uv               | 0.12.1           | Python 与虚拟环境管理   |
| Python           | 3.11.15、3.12.13 | AI 后端与 ViMax 运行时  |
| FFmpeg / ffprobe | 8.1.2 full build | 音视频合成、转码和探测  |

`uv`、Python 和 FFmpeg 的用户级 PATH 已写入系统环境。新开的 PowerShell 会自动生效；当前窗口如需立即使用，可执行：

```powershell
$env:Path = "$env:APPDATA\Python\Python312\Scripts;$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:USERPROFILE\.local\bin;$env:Path"
```

## 已下载并完成依赖安装的候选项目

所有第三方源码位于 `upstreams/`，该目录已被本工作区的 `.gitignore` 排除，便于后续把自研代码与上游代码分开管理。

| 项目       | 固定版本                                   | 已完成                     | 建议用途                                            |
| ---------- | ------------------------------------------ | -------------------------- | --------------------------------------------------- |
| LumenX     | `7a1213a0db73ab90ca976f5c4b4ca680e1ae1d2d` | Node/Python 依赖、前端构建 | 小说拆解、脚本和分镜生成的参考后端                  |
| Wind Comic | `b669de64f871f5a96f50d4c7afca341662e13683` | Node 依赖、Next.js 构建    | 第一优先主流程原型；已有多 Agent 和 Grok 视频提供器 |
| ViMax      | `05a48943878312d88fe5a016c12a9654940ecc43` | Python/Node 依赖、Web 构建 | Agent 编排、会话与制片工作流参考                    |
| PrintFilm  | `b5ed4b840b048a921e801accc253a0d4549137df` | Node 依赖、Vite 构建       | 漫剧编辑器和桌面端交互参考                          |

安装后的 Python 虚拟环境位于：

- `upstreams/lumenx/.venv`：Python 3.11
- `upstreams/ViMax/.venv`：Python 3.12

## 启动方式

### Aijian Studio

```powershell
Set-Location C:\Users\Administrator\Documents\sp
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\dev-windows.ps1
```

首次脚本按锁文件安装 pnpm/uv 依赖并校验 OpenAPI；第二个脚本同时启动 FastAPI、Vite 和 Electron。当前固定端口只用于开发，随机回环端口 sidecar 属于下一切片。

### Wind Comic（建议先验收）

```powershell
Set-Location C:\Users\Administrator\Documents\sp\upstreams\wind-comic
npm run dev
```

### LumenX

```powershell
Set-Location C:\Users\Administrator\Documents\sp\upstreams\lumenx
npm run dev
```

根命令会同时启动 `.venv` 中的 Python 后端、Next.js 前端并打开浏览器。后端开发端口是 `17177`。

### ViMax Web

```powershell
Set-Location C:\Users\Administrator\Documents\sp\upstreams\ViMax\web
npm run dev
```

默认访问 `http://127.0.0.1:4173`。需要正式生成内容时，再从 `configs/agent.example.yaml` 创建未纳入版本管理的 `configs/agent.local.yaml`。

### PrintFilm

```powershell
Set-Location C:\Users\Administrator\Documents\sp\upstreams\printfilm
npm run dev
```

## API 凭据

本次没有把任何密钥写进源码或示例文件。接入时至少需要准备：

- OpenAI API：脚本拆解、提示词、导演 Agent 和结构化输出。
- xAI API：Grok 文本或 Grok Imagine 视频；Wind Comic 已预留 `GROK_API_KEY`、`GROK_BASE_URL`、`GROK_VIDEO_MODEL`。
- 可选的图像/视频服务：DashScope、Kling、Vidu、Veo 或其他兼容服务。

ChatGPT/Grok 的网页会员登录与开发者 API 凭据应分开配置；软件只读取本地环境文件或密钥管理服务，不保存网页账号密码。

## 当前硬件策略

本机检测到 Intel UHD Graphics 730，约 2 GB 显存，没有 NVIDIA CUDA GPU。因此暂不安装 ComfyUI、大型扩散模型和本地文生视频权重：本机负责剧本、分镜、任务编排、素材管理、FFmpeg 合成与预览，生成模型先调用云端 API。这样可以先完成产品闭环，后续如增加 NVIDIA 工作站，再把生成提供器切换到本地服务。

Docker Desktop 也暂未安装，因为当前四个项目均可直接运行；等进入 PostgreSQL、对象存储和队列服务的团队联调阶段再安装更合适。

## 验收结果

- 四个仓库的依赖树安装成功。
- LumenX 的 `fastapi`、`dashscope`、`demucs`、`uvicorn` 导入成功。
- ViMax 的 `opencv`、`faiss`、`langchain`、`openai` 导入成功。
- LumenX、Wind Comic、ViMax Web、PrintFilm 的生产构建全部通过。
- 四个上游仓库源码内容均与各自固定提交一致。

可随时运行 `powershell -ExecutionPolicy Bypass -File .\scripts\verify-environment.ps1` 复查核心开发环境；追加 `-IncludeUpstreams` 才会检查未纳入仓库的上游研究副本。
