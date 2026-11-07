# 整场建议与试听：真实完成时点同步

根固定 35 的原完整 renderer 记录为 5482 通过、2 失败；两处均为旧测试同步，不改产品、CAS、原 400ms/80ms 定时器、次数或全局超时。

- 整场建议：`firstOrdinarySave` 是打开以来的首次保存回执。若普通保存已经在第二次合法建议请求前结束，再等待该旧回执不能证明请求之后又写了一次。受控 before 先等待该真实普通保存，原最终不同 hash 断言确定失败。最终用仅本例的准入 gate 控制原普通 `queue.save`，第二次合法 producer 完成后才释放到真实队列/写盘，等实际保存完成再交付 held reply。保留首次/第二次完整 hash 不同、成功请求等于当次 canonical、最终 metadata-only/full creative 一致、严格 2 RPC、零 apply/provider。gate 在 finally 释放，失败不挂住夹具清理。
- 试听：`preview` 已被调用只表示准入；mock 仍 await 真实 hash，hook 尚未拿到返回。受控 before hold 合法 native reply，原立即断言复现 busy=true/result=null。最终先等 hash 核验后的 producer 准入，明确断言 pending，然后释放回执并等待真实 settled。保留 latest live 写入、2 次 save、1 次 preview、后续 assembly metadata 不重开。

证据：`/tmp/final-checkpoint-controlled-before.log` 精确两例均失败（其余 15 未选）；最终 `/tmp/final-checkpoint-fixtures-final.log` 两文件完整 17/17 通过。首 after 的 17 通过不是最终 gate 证据：正式类型发现 fixture options 被旧 mock 同名参数遮蔽，修为 `fixtureOptions` 后重新跑完整 17；首日志与静态失败保留。最终正式 web typecheck、目标 ESLint、Prettier、diff 检查另有 `final-checkpoint-fixtures-*-final.log`。

这里不重跑完整 renderer，也不把定向通过覆盖原完整失败；根在冻结新源运行原完整门。无 native/API/媒体/浏览器阈值修改。
