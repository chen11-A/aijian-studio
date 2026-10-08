# QA03 SOURCE 项目名称 CAS-only overlay：新静态封套

状态：`FROZEN_CANDIDATE / C19_SYNCED_NOT_QA_ACCEPTED / NO_RUN`。旧 3E59 全文件候选及其 QA 封套已在上级目录 `HOLD-CAS-OVERLAY.md` 暂停；本目录为新版本，绝不复用旧批准。没有运行本目录测试、构建、sidecar、Electron 或 provider；c19 单文件同步由 MGR04 完成，QA03 未写产品树。

## 固定输入

- MGR04 冻结 `20260928-project-name-cas-c19-overlay-1/SNAPSHOT.json` SHA256 `EE77C4EEB6B75A20C776CE9CF5C7048B14DEA23441F5F8B1F5B3F892DF5AF312`，状态 `FROZEN_C19_BASE_CAS_ONLY_NOT_SYNCED_NOT_QA_ACCEPTED`；唯一 DEV03 StoryPages 从 c19 原版 `13998D8D7BBCA0CC857231469B5CD337352D37A60474253DEB5C1AF9EA834929` 改为 `34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60`。补丁 SHA `7C550DB8FB63CA0B0A166F55B3168A11092A50569FD253B938C5417594535DFF`。
- c19 保持 `model.tsx` SHA `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211`、`studio.ts` SHA `7521270E03EF55B649E8B0EA150FE859CB04EADFD7D84C0886FD856FDD378679`、`projectManagement.ts` SHA `7B549DCDBE7A4E3F4051FD815E98B013A07610D995C24BB135EDEBA656F8CD66`。快照附 studio/adapter 同字节依赖。新 StoryPages 无 `EpisodeScriptEditor` 导入；P23、作者 model 偏好和作者 studio script API 均不在此包。
- MGR04 已保护式同步唯一 StoryPages，`20260928-project-name-cas-c19-sync-1/SYNC-RECEIPT.json` SHA256 `6CB98F12620EEBCCC244ACEAD6DC1888B1E7302A403AAACEBAC63B22881B2ACF`，状态 `SYNCED_NOT_QA_ACCEPTED`，变更路径仅该文件，旧 `13998D8D…` →新 `34D272A7…`；HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、status 110、其他191源和 dist exact 未变、关联进程0。QA03 独立只读回算 c19 四目标 SHA 符合本包；`preflight.ps1` 未执行，读到的当前哈希只说明已同源，不是运行批准。旧全文件 3E59 不能用于补齐依赖。

## 一次性局部组件门

五案固定在 `project-name-source.test.mjs`：正式 source 改名一次 PATCH + 权威 GET、组件重挂载同身份、409 保草稿、UNKNOWN 重挂载只读且不重 PATCH、A 项目迟到回包不覆盖 B、fixture 样例与正式隔离。其中第一案同时覆盖重挂载，因此总数为五。mock 桥不代表新进程持久化。

`run-component-once.ps1` 只接受由 MGR02 独立生成并给定 SHA 的 v2 `APPROVED_SINGLE_RUN` 封套；模板为 `NOT_APPROVED`。要求 StoryPages 快照、同步回执、c19 四源 SHA、HEAD/status、外置脚本/配置/fingerprint/runner SHA、无 c19 关联进程及全新外置输出目录同时吻合。当前只读源指纹为 113 项 `EFC6FB239A95377A2AF99F511123DC18E8DD6FFC97FE91317528650CE1289A83`，dist 为 82 项 `CD421AE3BE47E71EA58679EBEC4F26A7F6FC641048DABB8A6FE0917F0D183075`；封套要求运行前完全吻合。原始 stdout/stderr、PID、exit、600 秒超时与清理、Vitest JSON、前后 source/dist 指纹都入收据；首 RED 停止，不运行 build。5/5 且无输入漂移时仅记 `TARGETED_LOCAL_COMPONENT_PASS`。

## 独立真实持久门

组件结果被核收后，再用单独批准和独立隔离 profile 执行 `run-sidecar-reopen-once.mjs`：第一 sidecar 进程 create→单次 CAS PATCH→GET→正常关闭，第二进程以同库新 PID list/get；核同 project_id/name/revision、单 PATCH，并保存双进程 PID、exit、原始 HTTP、SQLite 哈希。没有再次提交未知 POST/PATCH，也不触 provider。此门仍不等于 Electron 原生交互或 P01–P23 全面验收。

静态验证仅包含快照/依赖哈希回读、PowerShell 解析、JS 语法和 JSON 解析；未执行测试或服务。
