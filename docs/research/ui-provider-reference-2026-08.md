# 工作台与 Provider 配置参考（2026-08）

## 结论

本轮不是照抄某一个 GitHub 项目的皮肤，而是把多个成熟项目中已经验证过的交互模式组合成 Aijian Studio 自己的工作台：稳定的一级导航、项目上下文、独立模型连接中心、能力分类和可恢复任务入口。所有实现均为本仓库独立代码；研究链接不代表引入上游源码。

## 参考项目与取舍

| 参考项目                                                                                                                                                                    | 吸收的产品模式                                                               | Aijian Studio 的改造                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Jellyfish](https://github.com/Forget-C/Jellyfish)                                                                                                                          | 从剧本、资产、分镜到生成任务的完整漫剧流程；Provider、模型与提示词是后台能力 | 不复制其密钥持久化；模型连接成为独立一级工作区，密钥只进系统凭据库                |
| [LumenX](https://github.com/alibaba/lumenx)                                                                                                                                 | 全局侧栏、环境配置弹窗、模型目录和六阶段制作 SOP                             | 保留稳定侧栏和能力目录，改成全宽桌面工作台；不采用固定本机端口和宽松 CORS         |
| [Open WebUI provider connection docs](https://github.com/open-webui/docs/blob/main/docs/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible.mdx) | 用 OpenAI-compatible 协议接入不同供应商，允许登记模型 ID                     | 首版提供 OpenAI、xAI、OpenAI-compatible、Ollama 四类连接；项目只引用连接 ID       |
| [ComfyUI](https://github.com/comfy-org/comfyui)                                                                                                                             | 节点工作流、异步队列、只重算受影响部分                                       | 作为后续外部生成器适配；核心任务真相仍由 Aijian Task Ledger 保存，不嵌入 GPL 代码 |
| [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)                                                                                                         | 多供应商配置以及脚本到视频的快速生产入口                                     | 借鉴“先配置供应商再生产”的低门槛入口；不把一键生成当作不可追溯黑盒                |

## 本轮界面决定

- 桌面基准采用 224px 固定侧栏加全宽工作区，不再把 390px 手机布局放在桌面画布左侧。
- “模型与 API”是一级工作区，不依赖先创建或打开项目。
- Provider 表单把供应商、连接名、Base URL、API Key 与文本/图片/视频/配音模型 ID 分层展示。
- 连接卡只显示密钥状态，永不回显、复制或导出 API Key。
- ChatGPT/Grok 会员与开发者 API 配额在界面内明确区分，避免把网页会员误当 API 授权。
- 颜色从高刺激荧光绿改为中性石墨背景与单一紫色强调；状态仍同时使用文字，避免只靠颜色表达。
- 390px 下品牌与导航分成两行，导航可横向滚动；桌面截图和手机截图分别标注，不相互代替。

## 明确未吸收

- 不复制任何上游组件源码、图标、素材或独特文案。
- 不允许 Renderer 读取凭据、任意调用 URL 或获取本地 sidecar 端口。
- 不在本切片执行“测试连接”网络请求；在 SSRF/DNS rebinding、重定向和私网策略完成前，界面只登记配置，不伪造“连接成功”。
- 不依据 Base URL 自动信任 OpenAI-compatible 服务；未来测试连接由后端 Provider Gateway 完成。
