# QA02 来源预览下一次原生运行关口

状态：`V9_STOP_BEFORE_NATIVE_SEND_RELEASED`；QA01 曾对修复后的 sidecar 与媒体响应给出独立 GREEN，MGR02 批准的 v9 原生尝试已执行一次并释放。此文件保留准备与停止证据，不作为下一次运行批准。

## 已封存的参照

- v6 原生 1424×881 布局可读；1424×720 原生 RED：摘要区高度不足、操作按钮换行及裁切。v6 结果 SHA `DBB542BAC58350589C71E8A46E687BE3E7D95ABB49490956CD38225C427FCEEA`。
- 低窗 CSS 目标源 SHA `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E`，同步回执 SHA `6F76ABAFEE75BFFE219F3E1646A17296989B39D96D7D59D7F56B48F3955E0EE8`。QA03 当时 Web dist `index.html` SHA `6D997E0C719E218B906ED733E39D7E3679272E034741D6033B6987EB1D2BDE62`；该静态/Edge 结果不能代替新原生布局。
- v7 结果 SHA `83F099E9406AC4613297BDB3EC1C95C65258FB038C7A8D483D889009D5BA0538`，首窗前退出、项目数 0、G1 未触发，故低窗 CSS 无新的原生结论。v7 原件、profile、日志和释放收据原样保存，不重跑其 runId。
- QA01 独立隔离 sidecar 检出 `media_asset_routes.py:203` FastAPI 返回注解注册失败、握手前退出 1。它是修复线索，不是 v7 原始 stderr；v7 直接根因仍为 `UNKNOWN`。

## 申请新运行的顺序

1. DEV06 仅修媒体路由启动注解；MGR04 单文件受保护同步；QA01 用固定候选完成 route/sidecar/媒体响应复验并提供 GREEN 的原始收据和 SHA。若失败，停在此处。
2. QA03 对同步后的 c19 重新构建并固定完整源码、desktop dist、Web dist 和工具清单；QA02 回读 HEAD/status/所有文件字节及 SHA，确认 CSS、构建输入和目标 `index.html` 实际同版。新 candidate 与 v7 清单变更单列，不沿用旧 SHA 冒充当前。
3. QA02 用外置计划生成**全新** runId、一次性 profile/evidence 路径和长合成来源文本 SHA；计划锁定 runner、OS helper、原生 G1 helper 的 SHA、最多一次 G1 送审、两次 Electron launch。MGR02 审完整计划、候选包、独占窗口及旧 profile 无复用后签一次批准；批准前不启动。
4. 原生运行先采 1424×720 原始几何和截图，再断言摘要高度 ≥120 px、三个动作按钮可完整见且命中；继以 1424×881、1024×881、Tab、滚动和正常重开同尺寸读回。保持 G1 审核送审与基线确认/签收/决策分离；不得触 provider 或用户媒体。

新运行即便布局通过，也只证明该 SHA/profile 下的原生来源预览；不覆盖 provider、MLT、媒体生成或最终 UAT。

## 本次待审静态包

- 当前待审 runId `qa02-source-preview-20260928T024337Z-qa02a`；计划 `native-source-preview-plan-qa02-source-preview-20260928T024337Z-qa02a.json` SHA `F00CB559B638124B66A9637C717F6260AD543F8799EF1831186CEAC16B8F69A6`，QA03 修复后指纹 `after-route-fix.json` SHA `0AB5D6FB10FC49F62FF173AE9E9E7FAF891E0D3F229F203DD7EE9E49EA9D59A8`。前一版 023635Z/760D 静态计划已撤回、原件保留且未运行。
- v9 runner SHA `5EC21EB6B0F7A4A33660E271722B9BB788FCAA019202B622C33D5CA4E83E301F`，一次性 wrapper SHA `7586C2FA2CD6077124499AD5BAC668629DF03F30D907A217987E8BB6867A38D0`；OS helper `1B10779A...`、G1 原生 helper `FC9C7AF4...` 未改。
- 相对 v7 197 文件清单唯一变化为 `services/api/src/aijian_api/media_asset_routes.py`：旧 `02F85E...`/10998 字节→新 `931D14...`/11056 字节；HEAD/status、82 个 dist、合成 sourceText 均相同。同步回执 SHA `25348454B033D4DA8021CFFC8A7CDC18B2AAFE2721010F6F95AC9E6F56D7A78B`，QA01 GREEN 回执 SHA `EE5917C6FEFFE789ECD23E4308E1CA039FFF57838E072BC9C19478670514C3EE`。
- 三个 v9 JS 文件语法通过；当时目标 profile/evidence 不存在、相关系统进程 0。MGR02 随后批准同一 runId 一次性尝试，批准 SHA `EF261EFE8C0DB304FB5B7DB0BE89920F033704BDAE30DC6B7AC259BD68B333B4`。

## 实际 v9 停止与释放

一次性 wrapper exit 1。结果 `result.json` SHA `8DDE8AFACBB18DDB140053F08FF669340FB0B70442A74ACACA34F3FB95484EE2`，分类 `STOP_OR_UNKNOWN`；原生助手回执 SHA `83F4BA8213889EE7758F17B7C8E4052318B993BE5968855DFF4857CB61E21F6A`，精确状态 `STOP_BEFORE_NATIVE_SEND`，`focus_attempted=false`、`native_action_attempted=false`。原始 stderr SHA `3088D4706A9FEAB711EF29F2DDBD7679E54C7AC0CEE835F43EDBBBB0E5D19D9F` 指向前台或输入未达到助手的空闲稳定门；不得把它归为 CSS 产品 RED。

隔离库只读回执 `db-readback.json` SHA `93CE1E541D0C09F7A3E984EDC4F722636A36FC8827B0233A2F97CA10545968DD`：合成 project/document/source manifest 各一，review/accepted 为空；唯一 G1 challenge 未消费，审核提交 0，provider 连接/许可/消耗均 0，integrity ok、外键错误空。只完成第一次 launch，布局样本 0，720/881/1024、Tab 和第二次重开均未测。正常关闭后相关进程 0，两处 LOCK 均可独占读取，197/197 文件 SHA/字节、HEAD/status 不变。窗口释放收据 `window-release.json` SHA `37086D10F9308BFE0FA14222B01DDEAA8D106C889686E58737EA96B4FAFE37D5`。该 runId/profile 不复用；任何新运行须另行审门。

CTL 随后撤回 v10 静态方案任务；未创建 v10 plan、runner、runId 或 profile。下一次原生复测须先有用户明确的前台可用条件，再以届时固定候选、新 runId/profile 和新审门执行完整 G1 链。现只保留 v9 环境停止及发布收据，不因这次焦点门失败降低空闲阈值或换 runId 连试。
