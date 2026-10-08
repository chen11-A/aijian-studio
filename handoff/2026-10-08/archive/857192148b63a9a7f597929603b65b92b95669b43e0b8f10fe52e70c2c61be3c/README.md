# QA03 / SOURCE 项目名称持久化：静态送审包

状态：`PLAN_ONLY / RED_INPUT_MISMATCH / NO_RUN`。本包只准备可复核的局部 QA；没有运行 Vitest、构建、Electron、sidecar 或 provider，也没有写 c19 产品树。2026-09-28 抓取时，DEV03 的 StoryPages 活源还没有此改动对应的独立冻结快照；下面的作者 SHA 是当前活源指纹，MGR04 同步前必须由唯一 owner 和 MGR01/MGR02 重新核实。

## 目标与边界

唯一最小目标是正式 `#source` 页的项目名称：输入草稿、一次 revision CAS PATCH、权威 GET 后才显示保存成功；组件销毁重建后由权威列表恢复同 `backendId/name/revision`；409 保留草稿并要求重新读取；UNKNOWN 锁住原操作，只读核对，不自动二次 PATCH；切到另一项目时旧回包不覆盖当前标题。fixture 的样例输入继续与正式路径隔离。映射基线 UI-01、UI-02、UI-04、UI-06，P01/P04/P05、AC02/AC03/AC09 的一个局部切片。组件测试只能证明 mock 桥下的页面行为，不证明新进程持久化、原生窗口或全部 P01–P23。

## 源与所有权

| 路径 | owner / 作用 | 作者 SHA256 | 当前 c19 SHA256 |
| --- | --- | --- | --- |
| `apps/studio-web/src/aivora/StoryPages.tsx` | DEV03，唯一新候选；正式 source 输入与回包保护 | `3E59A3D1F9DF4818B7283013B4BB2EB2CD012AD2CCF73234ACEB897DDC94DE82` | `13998D8D7BBCA0CC857231469B5CD337352D37A60474253DEB5C1AF9EA834929` |
| `apps/studio-web/src/aivora/model.tsx` | DEV03，正式项目加载、选择及 source 上下文；已有冻结快照 | `4B6CCD357B481D772458EAE68B83B0A4BB7DA3574543109147EA4382FAA52A1B` | `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211` |
| `apps/studio-web/src/api/studio.ts` | DEV04，桥接 `getProject/updateProject` | `5598B535490C66107F9B4E35CC1EF6011552DD970A89663895AEF769228B1953` | `7521270E03EF55B649E8B0EA150FE859CB04EADFD7D84C0886FD856FDD378679` |
| `apps/studio-web/src/aivora/adapters/projectManagement.ts` | DEV04，journal/CAS/readback，已同字节 | `7B549DCDBE7A4E3F4051FD815E98B013A07610D995C24BB135EDEBA656F8CD66` | 相同 |

`model.tsx` 已有 `release-snapshots/20260928-project-entry-model-1/SNAPSHOT.json`，SHA256 `25B496043B2D8ED997CEE4294FF522945456C994FD2915E542A316E74B2F2F89`，但尚未同步 c19。`StoryPages.tsx` 的旧 CF65 中间版与本次目标不等价。正式入口 `aivora/main.tsx` 挂 `<DemoApp />` 且不传 fixture；`isFixture` 由 `!!fixture` 决定；新 StoryPages 仅在 `d.isFixture` 时渲染样例输入，否则在有 `backendProjectId` 时渲染 `ProjectNameEditor`。实际产品还有别的 demo/内存缺口，本包不能外推为全产品去演示。

## 顺序和停止门

1. **RED0 源身份**：由 DEV03/经理先冻结 StoryPages 精确字节并签唯一 owner；MGR04 按受保护窗口同步 StoryPages、已冻结 model 与对应 DEV04 studio 候选。每项重新计算 SHA，和本包及新快照逐一比对。`preflight.ps1` 任一不符 exit 2，立即停，不启动测试。当前 c19 至少三项不符，所以预期 RED。若作者活源 SHA 漂移，也停并更新送审包；不能用新旧混合结果补签。
2. **局部组件门**：RED0 解除并经 MGR02 指定运行窗口后，使用本目录 `vitest.config.mjs` 与 `project-name-source.test.mjs`，固定 c19 四输入 SHA。只跑 5 个正式 source/fixture 组件用例，保存 stdout/stderr/exit、脚本与配置 SHA、c19 HEAD/status/source SHA。任何一例 RED 停止，不继续 build/native。测试只用本地模拟桥；无外部调用。
3. **真实持久门**：组件通过后，复用已存在的 PROJECT01 后端 CAS/rename 测试作为回归参考，另外用新隔离 profile 的真实 sidecar 完成一次正式项目新建、改名、正常关闭、**全新进程**重新打开/list/get，同 `project_id/name/revision` 且没有重复 PATCH；记录请求/响应原文、进程/DB/profile、退出码和 SHA。此门需要另交精确脚本与隔离 profile 审核，当前组件脚本不能代替。若真实后端版本不含本候选所需 contract 或 profile 不独占，停。
4. **扩展门**：仅在上述结果被核收后排原生 UI、窗口焦点、完整 TS/build 和 P01–P23 逐页验收；这些都不属于本包的 PASS 声明。

建议执行形式（仅记录，当前不执行）：`pwsh -NoProfile -File <本目录>/preflight.ps1`；待其 exit0 且 MGR02 放行后，以 c19 已安装的 Vitest 和本目录配置执行单文件测试。所有运行记录写本目录新的 run 子目录，不覆盖旧原始证据。

## 局部风险与独立缺口

- `SettingsPage.tsx` 当前正式 `projectSettings` 仍落入 `FixtureSettingsPage`，仅内存更新并显示“演示”；属于 P23/UI-01/UI-06 独立 RED，未被此次 SOURCE 改名修复。
- StoryPages 正式 source 仍有“选择样例文本”按钮文案；UI-01 逐控件审计未完。这里先锁一次真实改名路径，不删除已有必需入口或伪装整体完成。
- 页面组件 remount 仍是同一 mock 内存数据；只有真实新进程/隔离库门能证明持久化。UNKNOWN 下列表恰好读到目标值，也不得归因原 PATCH 成功。
