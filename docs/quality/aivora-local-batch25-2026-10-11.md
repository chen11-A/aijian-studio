# 第二十五批本地检查点：实际私有原生所有者源码接线

父提交 `08d53f70fcce5cce21c86a609a85bcf9140a4098`，总基线仍精确为
`32d014624aad134a6884121a58a26b75088104c9`，仅本地候选分支。
只读核验参考分支仍同一基线；不push/merge/远端CI。

本批实际代码从main生产工厂接至所spawn sidecar的原stdin/stdout、sidecar.run
的NativeParentPipe、NativePreviewOwner和NativeWindowsJob，再到host.cpp。
不是仅添加可注入接口。main及sidecar编译期准入列表都为空，无用户/环境/HTTP
或磁盘profile可开启；默认runtime=null。真实Python sidecar私有入口实际测试
非法prepare回REFUSED、精确合法opening回UNAVAILABLE，且拒绝在WinAPI/资源/
快照之前发生。当前不是可播放/已安装状态。

复用单一SQLite计划和原件快照租约、已有创建时受保护cwd与最小环境；runtime/
来源文件和目录链以原句柄验证/持有。PE原始字节从同一持有stream分块读回main
闭包校验。sidecar从精确拥有材料独立重建OPEN、逐字节比对并冻结在只读文件
句柄，在第24批最终SQLite写门内同步执行原子Job/继承句柄CreateProcess与resume。
子进程首个OPEN从该原文件句柄读取，后续命令才走独立控制pipe；没有门外晚发
首包、新存储、provider、编码、发布或费用行为。

原始Job/start和stop同锁；所有partially owned fd/进程/Job由先注册的所有者保留。
实际reader/writer/observer线程保留原线程DuplicateHandle，CancelSynchronousIo
只发取消请求，仍须实际join、Job零活动和原handle已关闭。root退出先等reader
排空，不能充当停止证明。线程/进程handle关闭、启动结算、Job查询或join不明
都保持UNKNOWN和原材料/工作区所有权。main退出先native shutdown，再关闭
sidecar原管道。旧FFmpeg微软签名策略和旧C++OwnedJob/SealedLaunch源码保留；
生产实际所有者是Python WinAPI，未宣称调用了未编译的C++包装器。

独立审查发现并先修以下组合问题，再进行交付：

| 问题                                               | 最终处理与证据                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 私有JSON重复字段可被JSON.parse覆盖                 | 原始规范字节核对及Python递归unique fields，原ID/实际PID绑定，坏回执整通道关闭            |
| root退出先于reader尾字节                           | observer实际等待stdout/stderr reader排空与join再发exit；真实Python线程/held pipe独立重验 |
| supervisor首次mutation代号推进与runtime/host不一致 | mutation仅current+1，status同代；每个原waiter精确绑定generation，host源码同步推进        |
| 完整CLOSED回执后同turn退出误判FAILED               | pending原操作先核对回执，再判定观察到的退出；CLOSED不替代owned cleanup证明               |
| readonly轮询尚待定时未发送的mutation推进代号       | readPending占用与mutation互斥，runtime写入前防卫；无写入不推进、不重发UNKNOWN            |

另保持256条原mutation/1024条wire边界，UNKNOWN journal分支也不能扩容；线程
CloseHandle失败保留原handle，实际join后仍拒绝stop证明。独立复核最新组合、
初始held OPEN在真实SQLite门内及部分异常保留、reader drain与静态源SHA。
独立审查范围和未覆盖边界见随包原始报告，不能称无穷尽缺陷或Windows通过。

本批覆盖162个不同桌面范围用例及100个不同Python范围用例。首轮最终161桌面
（7文件）/99后端（6文件）通过；末次补startup重复字段和非str operation拒绝后，
受影响23桌面/17后端再次通过，其余已通过未变源码证据保留并核SHA，重复不累加。
全仓TS no-emit、6生产Python mypy、12桌面ESLint、8文件Ruff/格式、TS/文档格式
及公开契约检查通过。旧supervisor并发读/写预期因新的明确串行安全策略更新，
保留pending mutation/旧代拒绝，并增加真实supervisor→runtime字节组合回归；
不是删掉安全断言。首轮组合失败、类型错误与Ruff import-order已修，保留本批
修复记录和独立原始失败日志，不归为既有无关。未重复无关全量或coverage。

受控PE/Kernel/协议测试、真实临时SQLite、真实Python线程和sidecar入口拒绝
不等于Windows API、C++编译、安装、原生程序、解码/窗口/显示帧/音频clock或
创作质量实测。所有准入profile仍为空。实际二进制/完整license/source/动态及
系统驱动闭包、Windows受保护目录/句柄/TOCTOU和播放验收，须有明确获准执行
环境及具体构建获取动作清单后继续；本批无下载/构建/安装/原生运行/收费。

完整23页五阶段及预算/正式媒体声音/动态预演/正式审片输出/Windows恢复仍开放；
原Word未逐页核对，不称历史全部需求穷尽。旧TEST/DRAFT32视觉32音频30分钟1920、
安全/许可/CI/Linux归档问题原门槛不变，无用户账号工作区或电脑操作。
