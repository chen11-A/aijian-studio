# REL01｜M1 来源候选与制作使用交接

核对时点：2026-09-24 01:35 UTC。此清单只读映射 QA02 当前 c19 候选、构建和第二轮原生结果；不释放 c19，也不代表 H87 来源闭环通过。唯一交付是 AIVORA Electron 桌面软件；`apps/studio-web` 是内嵌桌面界面源码，其 renderer 构建属于桌面打包链，不表示独立网站或浏览器产品。

## 同版候选身份

工作区：`C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923`，HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`（detached）。当前 `git status` 只有两项修改：

| 文件 | 差异 | 当前文件 SHA256 | 归属 |
| --- | --- | --- | --- |
| `apps/studio-web/src/aivora/model.tsx` | +1/-0；在 `readRealStoryWorkspace` 的 `sourceStageFromManifest` 后加入 `setSourceManifest(manifest);` | `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211` | MGR01 签审、REL01 限定部署的产品修复 |
| `apps/studio-web/src/aivora/model.test.tsx` | +62/-0 | `807ABAEBAD12C4E1DE3539427A44ABCB599CAB27F03F2ECAF8CAB36AEA664FB8` | QA01 回归测试，必须保留 |

两文件对 HEAD 的 `git diff --binary` 原始 3,210 bytes，SHA256 `1BAD75EE4F875139015D7B48630A34DBE582A1A76335848B425D21D50561AF3C`；其中产品 `model.tsx` 单文件差异 SHA256 `602BC46C0216BE3723D078C3A7EFEA696AD9A4CF38BC4067CFB7F2802F0C47D8`。无新提交时，制作与 QA 必须用 HEAD＋双文件差异/哈希识别候选，不能只报 HEAD。

QA01 对该差异包的同序列定向 RED→GREEN 已由测试经理签收，GREEN 为 1 passed、38 skipped；仅覆盖来源清单时序回归，不是原生 UI、长文或整阶段通过。

## 构建与 QA02 第二轮运行映射

构建证据目录：`C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/m1-build-20260924-091807/`。桌面内嵌界面构建记录 `web-build.result.json` 与桌面主进程构建记录 `desktop-build.result.json` 均为 exit 0；证据文件名沿用项目脚本原名。`postbuild.json` SHA256 `51C1EDB50285A458378C0B32693E85EF66014CBE23C7A5F9107D15B227D53945`，绑定上述 HEAD、双文件差异、desktop `dist/main.js` SHA256 `343ACE14A364BE4E1F89248AF2B85BD53B76E0EF60B8B2229AF8C593C068FC7F`、`dist/preload.js` SHA256 `D899120B5E3890D7C27B7EF3E9DE743A6750E9D225FB115333500DE44509D591` 以及 25 个内嵌界面 dist 文件的完整清单。`rerun-preflight.json` SHA256 `F7135B21CBAEDB045ECA0DDEFE766AD6A0C7236B332B312C99C214D9435FE53C`，记录第二轮前源差异、runner/helper 和 dist 哈希及修改时间匹配。

第二轮原始结果：`C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/native-source-qa-20260924/evidence/qa02-2026-09-24T01-29-20.112Z-11612/result.json`，SHA256 `040BDDD90EB7C9F93B70973EDB406A9D1B5AA3A4D586B0620BF6E37186274330`，状态 `FAIL_OR_UNKNOWN`。runner SHA256 `92F0F895F20C2CCB2C09274077EE4A2929105DD4277BA3AD7BF62EC1DC70813A`，原生 helper SHA256 `45ED545A16296E512864E667F1546B503B988F71FE3CA282AF1686D210281243`。

短文 `C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/离别30秒剧本.md` 已在该轮创建项目、导入；UI 预览 SHA256 `466F23B789B47FA1231B0891E80385A13E530B02DE2F74481C4E98F5732DE008`，与冻结原件相同。记录的 Electron main PID 为 `8572`、wrapper `cmd.exe` PID 为 `18616`、sidecar PID 为 `11164`，这些是该轮历史进程身份，不供下一轮复用。helper 在任何确认 `Invoke` 与回执前未按预期标题/PID 找到原生送审窗口；`native-submit.json` 未产生。QA02 正常关闭后未发现驻留进程，但该轮 profile 保留待权威读回。送审、批准、选来源、正常重开与长文均未验证；预览哈希一致只证明本轮导入预览身份。

## 制作使用释放门槛与保护

1. QA02/MGR02 先在保留的独立 profile `C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/.aijian-dev/qa02-2026-09-24T01-29-20.112Z-11612` 做来源状态权威读回。仅当确认为 draft，才按已批准范围观察原生弹窗标题、PID、句柄和按钮；不在定位未知时 Invoke 或重复送审。保存原始读回、旧失败和 profile。
2. QA02 完成并正常关闭、确认 Electron/sidecar 无驻留后，由 MGR02 明确释放 c19 工作区、profile/PID、已验证的构建入口与 dist 清单，说明旧 profile 是否只读封存。MGR04 再确认同一 HEAD＋双文件差异和上述源/build 哈希未漂移，安排制作组独立运行条件。此前 REL01 不写 c19、不部署 basic12；ART01 不占用 QA02 profile。
3. MGR03/ART01 获明确候选身份、普通用户 H87 启动入口、独立 profile、构建来源/哈希和允许操作范围后，才能执行短文与不少于两万字材料各自的真实保存→送审→批准→选来源→正常关闭重开及全文/身份读回。制作使用反馈与独立 QA 结论分别记录。小说输入 SHA256 `29A4AA9E35D684C71BDFD67CD7265FB96C0682EA861B2F2008707CCD2646D697`；材料自述只支持内部测试用途。

版本组已签的 basic12 清单 `C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-candidate-manifest-20260924.md` SHA256 `B6E63998BF4FC205B1A66C6D314E5B71039C2AC79496CC98F3119160433E2582`，原始字节快照 `release-snapshots/20260924-basic12/` 的 12 文件指纹 `92C239ED530622FCFF63EFE9242B2DA1EC7B55E5F69D9E2AF94919EDA06DF769`。它们**尚未部署 c19、没有媒体 QA 或可播放 MP4 结果**，不得与当前 M1 构建/运行证据合并为同一个已测媒体候选。下一增量需新哈希和新快照，顺序送测由 MGR04 另派。
