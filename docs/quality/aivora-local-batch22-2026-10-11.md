# 第二十二批本地检查点：MLT宿主与进程适配器源码

父提交 `6a84cca92bbff1053f94b7cfd6baebf6f200f1de`，总基线精确为
`32d014624aad134a6884121a58a26b75088104c9`。只读远端参考分支仍为精确基线，
未换基线、push、merge或触发远端CI。本批落实已授权的可信原生源码与明确的
依赖/许可/能力合同，不以“未获批清单”停在接口或文案。

新增私有原件准备器复用同一个精确只读计划派生函数和既有原件哈希快照。
新保存/消费的权利/G5/原件仍fresh核验；hash、完整计划或原件变化拒绝。标记
启动后未知/超时/拒绝不能清理原件，只有owned终止证明才释放，准备失败不删
无关文件。无HTTP路径泄露、新数据库、任务、Provider、探测或编码调用。

新增主进程私有binary wire与owned pipe适配器，严格完整身份/代次/原pvo/pvc、
完整profile正文/规范hash/可信allowlist/实际runtime文件/能力/PE和许可源码
收据摘要匹配；只检查声称的profile_hash不够。有界报文/输出、原命令去重、
未知不重发、坏回执/过期/原生退出拒绝，终止未证明不得释放source/runtime。

新增C++ Windows宿主与OwnedJob源码、显式MSVC/CMake源目标，以及明确标记的
MLT7.40.0源码补丁。宿主以动态C API建立同尺寸CFR视频playlist与真实sdl2
consumer，仅从补丁专用呈现事件填写帧，拒绝image/SDL错误和选中素材test_image，音频硬件clock始终null。固定原件/
模块/数据hash以deny-write/delete handles核验，关闭自动插件扫描并只注册
core/avformat/sdl2；标准frame-show不能单独证明图像呈现，本地revision2补丁发专用事件。OwnedJob源码在CreateProcess时绑定kill-on-close单进程Job、
restricted handles和mitigation后再resume，零活动进程证明与管道join才可释放。
**C++未编译/安装/运行、补丁未对完整官方源码应用、真实所有者绑定尚未接入
main/sidecar、二进制profile未准入；production runtime继续为null。** 不称MLT
核心执行或可信加载已通过，不把接口/受控管道当真实窗口或播放。

具体源码/许可候选见 `config/native-preview-source-plan.json` 和
`docs/architecture/native-mlt-source-host.md`：MLT7.40.0+本地补丁、SDL2 2.32.10、
PThreads4W3.0.0、dlfcn-win32 1.4.2、dirent1.26、GNU libiconv1.18，以及新的
FFmpeg8.1.3源码解码库候选（关闭network/GPL/nonfree/version3等功能，实际构建
/ABI待验）。原8.1.2 Gyan GPL DEVELOPMENT_ONLY CLI与冻结TEST不动、不准入
发行。每项名称/来源/用途/许可状态/所需下一动作明确记录；源计划没有虚构
实际二进制SHA、完整下载体积、构建或许可通过。MSVC/SDK/CMake/Ninja/vcpkg
获取/安装/构建/运行以后分别申请具体动作，不在本批执行。

33项新受控字节管道/完整profile用例通过；59项既有supervisor/plan回归的源码
未改变，复用本批初轮通过证据，共92个不同桌面用例。21项后端通过（7个新
真实SQLite/原件准备用例，14项HTTP原生计划回归）；全TS no-emit、两生产模块
mypy、范围ESLint/Ruff/格式与契约检查通过。补丁格式以git apply --numstat
静态解析；不是对完整MLT源码应用或编译验证。初版TS收窄、fixture lint、测试
计时器、控制字符regex lint与mypy可空版本问题日志保留，源码/断言修正，原门槛
不变。没有构建/安装验证，没有下载或运行未授权二进制。

下一源码批次可继续私有sidecar/native Job实际绑定和封闭文件/PE准入代码。
版本1不覆盖图片/缩放/转场/多轨声音/音频clock/字幕/编码/发布；不扩大既有
DRAFT32视觉32音频/30分钟/1920或原件限额。完整Animatic/输出、正式审片、
预算/媒体/Voice/G5环境和全部消费失效仍开放。Windows真实编译、窗口/解码/
播放/clock、DLL竞态、Unicode路径、父退出/lease、安装恢复及真实创作验收留待
有明确授权和电脑恢复后进行。原Word未逐页核对，23页五阶段整品未验收；原
安全/许可/CI/Linux锁语义问题保留。无真实模型/媒体/语音调用、费用、凭据、
用户账号工作区/电脑修改、远端写入或未批准归档/旧LinuxABA采纳。
