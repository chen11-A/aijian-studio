# 原视频素材找回：实际 Pro 界面接线

基线为已冻结交付源 35afcad，合入真实合同 b3ef3e5 与最终 native/API 0816ee1；不复制 WIP ABI、不改 API 或生成消费者。实际入口：作品→作品设置→找回原视频素材→查看可核对的视频记录。

默认挂载不调用三桥。进入才用当前 FilmProject.backendProjectId 读取列表，不为配置创建 API 作品。列表只展示记录序号和 main 已确认原素材的文件名/SHA256/bytes，opaque attempt 仅用于回调，不渲染 provider ID、地址、路径、输入摘要。最多 100 条，hasMore 明确不是完整清单；空列表不推断所有生成已完成。

- 明确点击单条“找回原素材”才调用 recover；未知四原因各自说明，BUSY/账户不可用/找不到/传输失败均不冒称完成。
- 明确点击“另存原素材”才调用 native 保存选择器。SAVED 要与已找回文件完整元数据一致；CANCELLED 不写成功。recover 或另存的回执/传输未确认时，该条禁止重复操作，只允许用户重新读取实际列表再核对，不自动重发。找回未确认不误称用户已选择保存位置。
- 不替换当前 take、不继续旧任务、不调用 createProject/生成/图/TTS，也不写 FilmProject、占持久队列 owner 或触发费用许可。保存是原始视频素材，不含原任务另外制作的配音及后续合成；找回、保存或文件存在均不能证明完整观看试听。
- 回调捕获本机工程、API 作品、当前可观测账号状态/标签和开窗代次。账号变化事件在异步账号 hook 更新前同步退休窗口；主进程仍最终核实际身份，UI 标签不是授权。换作品/绑定、关闭重开、旧 recover/save/list 回包与保留的旧按钮回调均不能显示到新会话。
- 文件展示只接安全 basename、有限正整数字节和 SHA256；错误不显示原异常、路径或堆栈。旧素材是否适合后来编辑的稿件，必须由用户另行核对，不能暗套新输入。

当前阶段证据：新增真实 Pro 宿主首轮 14 项中 13 过，1 项测试误用了不存在的 host.apply，正式类型同时拦住；改为原 applyLive 后与 policy/交付/partial 联合 4 文件 41 项过。增加晚 save/账号代次后，与原 persistence/quit/next 架构规则联合 8 文件 71 项通过（`/tmp/generation-recovery-ui-joint-final.log`）；正式 web typecheck/build 通过。该阶段之后仅将 fixture 的 opaque ID/默认文件名对齐实际 native 格式及收紧说明，最终日志另补，不把阶段值覆盖原失败。

正常 Chrome 新专项尚未接入；这份宿主验证是受控 ABI/UI，不能替代真实会员/provider、Windows native 保存、实际解码与人耳试听。native/API 固定证据及原完整门由根独立记录，不在此累加本地子集或冒称全门完成。

最终本片：`/tmp/generation-recovery-ui-host-final.log` 新宿主完整 17/17 通过（14.28 秒总时长）；包括额外两条找回结果未确认只读刷新场景。正式 web 类型 `/tmp/generation-recovery-ui-types-complete.log`、最终生产构建 `/tmp/generation-recovery-ui-build-complete.log`、原合同生成对比 `/tmp/generation-recovery-ui-contracts-final.log` 均 exit 0，目标 ESLint 与交付格式/diff 通过。此前 8 文件 71 项是增加这两条之前的独立兼容阶段，未与 17 项累加成新全量。没有本机无沙箱正向或新正常 Chrome 验收声明。

## 总控独立联合检查

root将88与真实0816/纯SQL折行2c59、已冻共同boot修24无冲突联合为d5f79c04，新固定完整renderer进程1443318运行中，原完整API5264仍运行。API/native源逐项分别与2c59/0816无diff；后者已根原完整161文件2378、SDK42实际隔离require与compiled recovery入口通过，首并发12超时日志保留，未放宽原门。

新正常恢复16的e440纯QA另接dc14769，root独立全部12 Node契约120/120（22.88秒）、目标ESLint/8文件格式/diff0，日志`/tmp/aivora-video-recovery-browser-root-checks.log`。恢复功能分支另推启动正常Chrome；新16、旧420及完整quality不能在未出结果时写成功，旧legacy4分支首正常失败仍由界面另树诊断。
