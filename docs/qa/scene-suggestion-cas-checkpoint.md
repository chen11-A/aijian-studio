# 整场声音建议：CAS 回执与后续保存的检查点

完整 renderer 门在 `ProWorkspace.scene-audio-suggestions.test.tsx` 的保存时间变化用例中失败：第二次请求已被合法接受，但断言将该次请求的完整 raw hash 与稍后普通保存后的 disk hash 比较。这里没有修改产品 CAS、两次请求上限或保存队列。

受控复现保留真实 Pro 和原 400ms 自动保存：第一次请求返回 `PROJECT_CHANGED`；第二次 producer 逐次读取完整 raw，严格核对 hash 和全片所选版本，在成功读取处记录不可变回执；仅延迟回复传输，等待真实 queue.save 的完成回执，再交付建议。旧断言失败，修后原 12 项全部通过。永久回归明确要求普通保存一次、建议请求两次、成功回执一次、两个请求 hash 不同，以及成功读取 hash 与最终 disk hash 不同。最终 raw 除 `savedAt`、`directory` 外完整一致，原音轨与创作输入不变，零 apply、零 provider。

默认假 native 遇到过期 hash 返回真实 ABI 的 `PROJECT_CHANGED/unchanged=true`，而非接受旧输入或抛断言异常。成功分支在返回前再核完整 CAS，回执来自当次读取，不由最终 disk 倒造。临时探针已移除。

受控前后证据保留在 `/tmp/scene-cas-controlled-{before,after}.{log,json}`；最终原宿主日志为 `/tmp/scene-cas-host-final.log`。这是合成 ABI 与真实 renderer 保存队列的时序回归，不是实际文件复制、试听或付费调用验收。
