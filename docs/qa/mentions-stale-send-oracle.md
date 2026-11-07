# 迟到引用回复：发送按钮定位与实际再发送

失败源 `93e4c65`，正常 Chrome `42353968456`／job `128347874453`：公开 4 条注释为 `refs-stale` 四窗口／画幅组合，`checkLine=299`。没有由这些注释推断另外 12 个组合的完整结果。

受控真实 Pro 复现原路径：角色页 art 请求已准入并 hold → 输入下一稿 → 剧本／角色页往返 → 明确 art → 人物改名 → 释放旧回复。旧请求没有发布卡片、没有把新画风写入，下一稿仍保留；但原 `button.textContent.trim() === '发送'` 断言得到 `undefined`，687ms 即失败。实际该页 composer 是 `<button aria-label="发送">` 内含 SVG，没有“发送”文本，旧等待条件永远找不到元素。这不是据失败推断业务 busy，也没有改 `withForeground` 或其他产品保护。

修后使用原 `send()` 的精确 accessible role/name 定位，验证可见、enabled 和真实试点击；保留完整的后续第二次新请求与新字段卡出现、捕获 userRequest、两次请求上限、新稿保留、旧回复零 apply／零新画风写、原媒体、全部 16 组合和原几何断言。假桥仅记录受控回复到达 return 边界的 `delivered`；不把它叫作 host／main 处理完成。真正可继续操作由实际第二次发送／新卡验证，不用 sleep、延时阈值或 React state 注入。

永久新增真实宿主同时确认 accessible 按钮 enabled、无遗留“正在写…”提示、实际 fresh 再请求成功；修后 779ms 通过。前后日志 `/tmp/mentions-stale-selector-{before,after}.log`；全引用 28 项 `/tmp/mentions-stale-host-final.log`；原默认 hold／delivered 契约 10 项 `/tmp/mentions-stale-contract-final.log`。正式类型与目标静态用 `/tmp/mentions-stale-` 前缀。未回改已冻结 e79 或风险试片 WIP，仍待总控新正常 Chrome 复验；本片没有会员／真实 provider／媒体／Electron 验收。
