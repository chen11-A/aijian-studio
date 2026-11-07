# 本地素材时长：等待真实输入值就绪

基线 `f655d59`。run `42324887817`、job `128257762881` 的新闭合诊断为 line235：`targetState=TARGET / reply=TARGET / calls=1 / matched=1 / busy=0 / writes=7 / preview=2 / assembly=1`。该行实际是对“使用时长”立即读值并断言 `2.25`；上一行才等待“当前版本已核对：2.25 秒。”。因此此前把这批失败称为时长文字等待失败不准确；现证据排除零 RPC、CAS 不匹配或未收到 TARGET。

`BundledAudioDialog` 的时长默认值由被选素材与 target 驱动的 `useEffect` 设置。实际 React Profiler 临时探针捕获同一次选择过程的两个真实 commit：作者信息与 TARGET 文字已经出现、时长输入仍是空字符串；随后 effect 更新为 `2.25`。没有改组件、使用 sleep 或延长测试时间。探针一项通过，日志 `/tmp/library-duration-readiness-probe.log`，临时源保存在 `/tmp/BundledAudioDialog.readiness.probe.test.tsx`，不固化“必须瞬时空值”这一实现细节为产品测试。

本修只让浏览器 QA 在原 target 文字等待之后，继续等待同一真实输入框 connected 且 value 恰为 `2.25`，再保留原 exact 断言。沿原 Playwright 默认十秒有界等待，释放临时 handle，不重试 native，不 refresh、改夹具时钟、放宽数值/几何或删除任一状态。原六镜/三版、四态十六组合、一次 add、inspect/assembly 次数、源素材保留、零 provider 与全部布局阈值不变。产品与原 260 态没有修改。

验证：实际组件探针一项、原本地库 Node 契约十项、目标 Node 语法/ESLint/Prettier/diff 检查。正常沙箱 Chrome 新正向待 CI；本机不绕过沙箱，不把当前诊断或 jsdom 当 Chrome 全过。
