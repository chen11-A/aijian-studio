# QA03 SOURCE 项目名称：原全文件候选暂停

2026-09-28 MGR02/MGR04 新依赖审查：作者 `StoryPages.tsx` SHA256 `3E59A3D1F9DF4818B7283013B4BB2EB2CD012AD2CCF73234ACEB897DDC94DE82` 导入 `EpisodeScriptEditor`，但 c19 当前没有 `apps/studio-web/src/aivora/EpisodeScriptEditor.tsx`。只读复核：作者该依赖存在，c19 缺席；c19 StoryPages 仍为 `13998D8D7BBCA0CC857231469B5CD337352D37A60474253DEB5C1AF9EA834929`。

因此 `PACKET.json` SHA `DAC411C8…` 和 `RUN-PACKET.json` SHA `69FAC016…` 是历史静态准备，不是可运行批准候选。`preflight.ps1` 与组件 wrapper 均钉死全文件 `3E59A3D1…`，对未来 CAS-only overlay 会拒绝；两个批准模板仍为 `NOT_APPROVED`。禁止为了通过门而将全文件 StoryPages、缺席依赖或其他未签模块并入 c19。

后续仅在 DEV03 基于 c19 `13998D8D…` 产出项目名称 CAS-only overlay、唯一 owner 与 MGR04 独立冻结/保护同步后，重新做依赖闭包与作者/c19 SHA 审计，重封 QA 脚本、配置、runner、快照和单次批准输入，再按组件与真实 sidecar 新进程两个独立门执行。五个组件用例及双进程脚本目前都没有运行，旧封套不可补填新批准文件继续使用。
