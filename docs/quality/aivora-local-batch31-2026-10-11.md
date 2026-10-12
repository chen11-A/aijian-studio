# AIVORA 第31批：制作表单可达与已校验图片预览

总基线仍为 `32d014624aad134a6884121a58a26b75088104c9`，本批精确父提交
`41e4895781294507c1eede42f01ae035db16fe51`。只在本地候选分支提交。因独立鼠标
实操发现阻塞，优先完成这组最小修复；原开发代号31的手工候选/装配设计与实现改列
第32批，不在本批提交或宣称完成。原设计审查文件名和证据保留。

生产改动共四文件：`apps/studio-web/index.html`、`vite.config.ts`、
`src/aivora/MediaPreparationPanel.tsx`、`src/aivora/v2-media.css`。
制作表单增加专属有界纵向滚动、fieldset/control最小宽度约束及长文本换行；图片的
meta/开发响应头 CSP 仅增加 `img-src blob:`。script/connect/media/font/object/base/
frame 策略、现有开发 inline 策略和原媒体读取/解码/URL撤销代码未改变。

## 实际证据

独立代理使用已安装 Chromium、Playwright 与 Vite dev transforms，加载精确父30
生产 renderer 的冻结源码，只覆盖四份核对SHA的修复源。不是静态组件替身或构建产物。
公共DTO来自双作品双分集 scratch SQLite，写入/恢复由受控桌面桥返回；原生 IPC 未运行。

同数据、光标点及 wheel1400 的 PRE/POST，1600×900、1440×900、980×680各普通/专业
模式共六组：修前 scroll=0，保存按钮 y=960.64/982.64/1004.64，不在主区；修后实际
panel scroll=219/241/527、按钮 y=741.64/741.64/499.64，真实鼠标点击保存。受控 UNKNOWN
每次仅写1，精确原操作只读核对后仍写1/读1。980 select 修前右缘704.30超过主区648，
修后594.50；实际点击原生右侧箭头并 ArrowDown+Enter 可换镜头，没有JS selectOption。
模式切换与取消未保存离开对话保留完整输入。

同一实际 owned PNG：1484B、640×360、SHA256
`837ca2f233f05e58b935f6a5a0b41a4939e5730e833ba50905f1822cf86f0df9`。
三个尺寸修前均被图片CSP阻断并误报损坏，修后实际Blob完整解码，980显示434×244.125
保持16:9。负控制确认Blob脚本未执行、外部图片仍被header/meta阻断、网络route=0。
这只证明本地完整图片预览，不证明序列裁剪/混音/字幕播放、Windows或帧精确审片。

独立安全复核核对Node原始字节ETag/MIME/长度/32MiB/SHA、renderer活动epoch和自有URL
撤销仍保留；既有预览6项、选定实际native client协议10项通过，未重复累计为新测试。
四文件范围Prettier、两份生产renderer/dev配置TS no-emit与范围ESLint通过。
契约/API/数据格式未改，复用第30批未失效契约与旧源码回归证据。
隔离no-emit首次scratch配置未能解析已安装Node类型，原失败保留；仅指定实际已安装
app typeRoots后两配置通过，生产配置没有改动，也没有安装依赖。
源文件/文档whitespace检查通过；整份暂存检查指出两份原始Vitest日志的EOF空行，
原日志按独立SHA保留且完整记录此退出2，没有抹掉失败或改动门槛。

原失败截图、harness启动/fixture/端口冲突日志、全部修前修后截图和脚本、两份完整
受控数据及安全复核，共283项原始产物已逐字节复制核对，见
`evidence/aivora-batch31/EVIDENCE_COPY_VERIFICATION.json`。原截图索引保留；增量总109张
截图不冒称全部逐张看过像素。525冻结源/assets按精确父Git blob和四份overlay恢复，
完整逐文件hash见独立 `FROZEN_RESTORATION_MANIFEST.json`；原两个完整scratch冻结目录
保留，没有采用历史归档排除规则或删掉旧tracked证据。Vite缓存/已安装依赖是运行条件，
不属于产品源码。最小补丁和四文件SHA另存本批证据目录。

## 未完成与交付边界

独立UX04–08继续开放：装配预览/编辑/保存距离、时间码/缩放/快捷键、专业模式只读右栏、
Voice入口和范围信息层级。专业模式权限/质量没有降级；没有借这些发现扩建服务器/PWA。
第32批候选与精确装配保存仍在独立工作中，未经完成验证不交付为已实现。

Windows原生窗口/DPI/字体/真实播放/关闭恢复、模型质量、Voice、实时序列、正式签发和
完整导出仍待后续，原Word未逐页核对，不能宣称全部23页或历史需求穷尽。
未build/install、运行原生或encoder、调用Provider/收费、保存凭据、操作账号/用户电脑、
推送合并/远端CI、自动重发UNKNOWN或放宽原安全/CI/许可/coverage门槛。

正式Library helper此前第29/30批在只读tools/list网络失败，未进入上传变更且没有29/30
附件ID；本批不因同一失败自动重试或绕过正式流程。本地证据/补丁不称可下载链接。
父端确认用户可用的最新下载仍为第27批，后续源码包完成恢复/哈希检查后另行记录。
