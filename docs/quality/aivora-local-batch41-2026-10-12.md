# AIVORA 第41批：原件监看、裁剪与专业右栏布局A

总基线 `32d014624aad134a6884121a58a26b75088104c9`，直接父40
`ea24e4707eb0687932dd07e17cf2fcd85dd7aaf7`、tree
`1f12ce10bf1dd7c5b01e2c5e00776d47fc063588`。用户同意布局A后实施；
期间服务流中断按原文件恢复，没有重建工作区、覆盖原diff或重做PRE。

## 实现与边界

8个生产UI文件＋2个测试：保存入口前置，原件监看与裁剪相邻、时间轴在下一行；
概况、画布、素材加入、手工候选与准备状态放在下方可展开区并保持挂载。
紧凑/较大监看只改CSS，内存偏好按作品/分集/视图区分。专业右栏有显式收起/
恢复，按页面保留偏好、Inspector/AI tab及原输入。隐藏内容退出键盘焦点顺序，
恢复可回原右栏焦点。主题、字体资源、导航、五阶段及数据权限沿用。

短窗口保留44px底部导航按钮，重新分配标题、状态和监看空间。较大监看确实
增加图像高度并压缩轨道视口，轨道仍可内滚。不改变原播放器读取/hash/URL
生命周期、裁剪/字幕/保存回调、UNKNOWN原UUID/journal或审批执行路径。
原件监看仍不应用裁剪/字幕/混音，不是实时合成或正式审片。

详见[架构说明](../architecture/assembly-workbench-layout.md)。装配Inspector
对象绑定及AI选中对象上下文的原缺项仍保留，未虚构typed对象或扩展权限。

## 检查与复用

- 6个受影响renderer文件58项最终通过：原件节点/播放位置、未应用裁剪/字幕/
  时间码、zoom、全localStorage布局前后相等、原UNKNOWN完整日志与UUID、
  重开、防重发、tab/对象/AI草稿及按页面偏好。既有隔离/迟到/坏回执保护保留。
- 实际`tsconfig.app.json`全src的no-emit类型检查、8个TS/TSX文件ESLint及
  受影响源码格式检查通过。首次references-only配置探查没有检查src，不计为
  类型证据；随后实际app检查及最终检查均已通过。
- 47个原业务handler AST、原件读取effect/dependencies逐项相等；
  `useEpisodeAssembly`与3个原SDK/业务adapter文件字节相同。API、desktop、
  contracts及OpenAPI导出脚本0改，复用39/40未失效的合同/native/Python证据。
  不重复无关全量，不构建或安装，既有CI、安全审计及旧确认fixture失败保留。
- 最后R4只改专业右栏CSS；9个其余源码/测试hash仍是已通过R3字节，复用
  58项、类型及lint，新增CSS格式和独立定向复核。没有把重复记录增加为覆盖。

## 独立真实操作与原失败

[完整报告](evidence/aivora-batch41/independent/INDEPENDENT_FINAL_LAYOUT_REVIEW.md)
SHA256 `89c1738037ab068be49b8526af6842f87a7957cb69f740f49de74d914bb5a5b3`。
生产renderer→实际desktop client→真实认证ASGI/routes/store→自有SQLite；
没有用成功DTO替身。实际80B/16×16自有PNG校验并解码，不能替代影片质量。

有效覆盖13组：R3普通/专业×1600×900、1440×900、980×680六组核心，
四组状态保留，以及R4三尺寸专业标签/上下文/焦点/页面偏好/轨道定向。
24个核心状态在同一capture中监看、裁剪、时间轴、保存完整框及命中均成立；
不是分别滚动后拼同屏。980主体从330px增至404px，compact时间轴432–593、
large456–593；图片元素高56/80px，宽窗128/192px。

31个案例DB整字节及所有行未变；310个SQL内容canonical hash、63次原PNG
真实SDK读取闭合；1446个案例GET，另5个fixture bootstrap GET，0 POST。
fixture bootstrap只补现有schema的1个空表，旧行未变，单列为准备动作。
UNKNOWN复用34原已落库丢响应的UUID和完整journal，没有点保存/恢复或自动原GET。

三类产品失败原件保留并修复：R1遗留30px直子div高度导致真遮挡；R2短窗口
时间轴底部裁切；R3 AI层遮住Inspector，实际鼠标不能切tab。R4限制专业pane
叠层并为Tab留槽后三尺寸双向点击通过。原PRE reveal、SQL列名探针、R4三个
API前ReferenceError及初proof硬编码计数错误都单列，未当产品通过或绕过。
R4额外六组在“不重复”steering到达前已启动，原件留存但不增加验收数。

dirty实证保留zoom2/frame85/clip2、AI未发送输入；恢复焦点回原textarea。
宽度变化的水平锚点误差0.265px，scrollLeft460→820→460，不能称宽度变化时
像素偏移恒定。较大短窗轨道36px，实际滚轮后完整bar可命中；工具条仍横滚。
所有owned进程已停，原PRE184及其seal逐SHA未变。

## 封存、交接与未验项

独立816成员100,168,750B、175PNG（142浏览器截图，17实际view索引）在
原云端独立目录封存，不重复复制100MB到Git。仓库保留报告、manifest/seal及
小型证明引用；[证据边界](evidence/aivora-batch41/independent/REFERENCE_BOUNDARY.json)
列原目录和逐成员SHA。根原日志、R1/R2逆差分恢复且匹配当时SHA的源码字节、
R3/R4实际拷贝及复用证明另封存。恢复相同字节不冒称早先物理copy。

第41本地候选及基线32累计轻量源码包保留原历史/全部旧封包，源码投影不是
完整候选Git树或历史。用户随后明确授权仅新GitHub分支
`chen11-A/aijian-studio:codex/aivora-handoff-20261012`的源码交接；推送结果
另以交接receipt为准，本记录不预先称推送成功。Library上传未获授权，不上传。

Windows已上线由父任务另做只读核对，本云端任务没有操作或同步电脑。真实
Windows媒体/安装/质量、完整23页和Word逐页仍未验；五项正式媒体、Voice、
实时多轨/完整导出、预算账本/策略、正式审片签发/发行缺口继续保留。同步先查
未提交内容，任何重启先确认保存；真实调用仍逐次确认完整账号/模型/内容/费用。
