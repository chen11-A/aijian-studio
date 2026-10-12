# 第二十三批本地检查点：被持有字节的PE依赖准入与启动封存

父提交`520852f7418d637d9db5c42b20563567e33078cd`，总基线仍精确为
`32d014624aad134a6884121a58a26b75088104c9`。只在既有本地候选分支继续源码；
没有远端写入、CI、工具下载、构建、安装或原生启动。

补上实际PE字节准入代码，解析Windows x64 PE32+的普通导入、RVA式延迟导入和
导出转发，而不是相信声称的PE收据。完整规范收据摘要、逐文件原始SHA/大小/
名称、解析结果、封闭DLL依赖图均须匹配。普通/延迟/转发缺少任一实际文件都
拒绝；宿主第三方启动依赖、动态CRT、System32/API-set同名载荷、重复basename、
错误架构/版本、重叠/截断RVA、未知receipt字段或清单条目拒绝。bound/VA-delay/
CLR、嵌入manifest和命名resource类型明确fail closed。系统DLL集合只能由可信
发布策略给出，不能来自renderer/用户manifest/环境或通配符。静态PE字节检查
不证明动态LoadLibrary、SDL驱动、系统依赖、代码签名或许可/完整源码已验收。

`MltLaunchLease`现在必须携带本进程从完整字节核验中产生的PE证明；原生pipe
factory在启动前同时核对其完整profile绑定，伪造/clone/另profile的证明不能
dispatch，pending lease只在未启动时可释放。证明是私有WeakMap持有的对象，
不是IPC凭据或可保存/跨进程重放的“批准”。真实binding以后必须从被持有的
native handles读取这些字节，不能以可变路径读代替。

新增`SealedLaunch` Windows源码在启动前持有并hash核对宿主、所有已准入runtime
文件及选用原件，目录链、canonical handle路径、非reparse/硬链接、大小和本地
驱动类型均拒绝未知；deny-write/delete handles保持到owned停止和reader join。
`OwnedJob`只接受其所有权、取消裸路径start；partial start不会丢弃封存。
最后手段析构若不能证明Job零活动进程则保留封存句柄到所有者进程退出，不把
job close/root exit/Promise rejection当清理证明。可信调用者仍须创建受保护
private cwd、核对PE/许可/原件freshness并保留每个迟到对象。CMake源码明确
`/MT`、`/MANIFEST:NO`及`/utf-8`；不修改既有FFmpeg的Microsoft签名DLL门。

本批41项PE用例和36项pipe/profile用例通过，共77个实际执行的不同桌面用例。
另外59项未变更supervisor/plan用例复用第22批通过证据并核对源码SHA，不累计
重复运行。全TS no-emit、范围ESLint/Prettier、契约检查通过。后端源码和所有
公开契约没有改动，复用第22批21项Python/mypy/Ruff证据，不重复无关全量。
测试PE/文件/notice全部是明确标注的合成字节，未调用native loader或编译器。

C++仍未编译/安装/启动；真实main—private sidecar—native Job/pipe reader绑定、
受保护cwd创建、从native句柄读字节、完整二进制profile/许可源码/OS与驱动
收据、Windows的预恢复Job/DLL竞态、进程退出/Unicode/window/解码/clock测试
尚未完成。下一源码批次可继续上述私有绑定；本批不是实际MLT核心运行验收。
生产`runtime:null`、准入profile空集合保持。上批MLT补丁SHA没有变，未对完整
官方MLT源码应用或编译；DRAFT32视觉32音频/30分钟/1920与原件限额不变。
原Word未逐页核对，完整23页五阶段产品和Windows恢复验收仍开放；预算/媒体/
Voice/G5环境/动态预演/正式审片输出等未用局部能力或后台存在冒充完成。
无真实模型/图像/视频/语音调用、费用、凭据、用户账号工作区或电脑操作；
原安全/许可/CI/Linux问题、未批准归档和旧LinuxABA规则保留。
