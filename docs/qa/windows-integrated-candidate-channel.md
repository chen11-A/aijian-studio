# 不发布的 Windows 集成候选通道

本片只给现有 `windows-integrated-installer.yml` 增加精确 push 分支 `codex/aivora-windows-candidate`。不是 wildcard；当前开发分支 `codex/aivora-windows-candidate-channel`、dev/main 或普通 feature push 不会因此触发。root 只在完整联合候选通过原质量门后，把该固定源码送往专用分支；本片没有 push、tag、Release 或真实会员调用。

原 tag、handoff PR、workflow_dispatch、repo guard、并发/timeout、所有构建和验收步骤及 tag-only release `if` 原样保留。候选 ref 是 `refs/heads/...`，不满足 `refs/tags/aivora-desktop-v`，只走测试 artifact 上传。既有成功交付内含 installer、JSON/截图、`INTEGRATED-INSTALL-RESULT.json` 的 candidate_head/实际 SHA/bytes 与 `SHA256SUMS`；未新增另一套收据或发布器。

## 实际链路与材料前置

1. `prepare-dev-core.py` 校验下载锁和四份 source-lock（uv.lock、pyproject、build-toolchain npm lock、Windows wheel requirements），准备固定 CPython/Node/Electron/NSIS 等；没有改锁或来源。
2. `freeze-sidecar.py` 保固定 Windows Python、离线 pinned wheel、系统 UCRT 来源白名单和 native 材料分类；`smoke-frozen-sidecar.py` 以新建合成 workspace 验冻结运行时，不接触既有用户数据。
3. `package-dev-core.py` 核实际 HEAD==GITHUB_SHA/无 tracked 改动、固定 Node24.19、development-only 冻结收据，再复用实际 runtime builder、renderer 及许可资源。未知 native 文件失败；不把许可证文字当 release approval。
4. `bundle-locked-media.py` 仅加入 config/media-toolchain-lock.json 的固定 FFmpeg/FFprobe bytes 并重建原 NSIS。development profile 和 `release_approved:false` 不变，正式材料批准状态没有被提升。
5. 原 bundled FFmpeg 两镜真实拼接；`smoke-subtitle-compose.py` 校验所带 OFL 字体/许可证 SHA，空系统字体目录下真实合成中文字幕；不是人工听看验收。
6. 原 workflow 用 RL LIMITED scheduled task 验每用户默认安装和 HKCU/non-HKLM；随后 `smoke-integrated-install.py` 验干净 `/D` 安装、真实 Electron health/本地 stub 样例、one sidecar→停止、卸载保留数据库和未知用户文件。拒绝已有安装/profile/delivery；未绕过该保护。

这些是当前源码中的必经步骤，不能由 Linux 准备结果提前宣称新的 Windows 候选已经安装通过。候选 unsigned，SmartScreen/真实用户窗口/无障碍、全面手工播放与正式发行另需实际验收；没有给出新的签名或许可承诺。

## 明确的升级缺口

原 `test-installed-dev-core.py` 确有同目录 reinstall 且保 DB/未知文件，但它是固定旧 media-free 分支、明确不接受 integrated media。现 `smoke-integrated-install.py` 尚无同一集成候选 reinstall→重启读取旧样例，所以不能拿旧收据宣称本集成升级闭环已过。下一窄片将复用当前安装/应用关闭机制补这一真实步骤，不改 installer 算法，不移植旧许可或媒体排除特例。

## 本片验证

- 真实 YAML AST 对照：除 push 的精确一条 branches 之外全部结构与基线相等；原 tag release guard 完全相同，candidate ref 不满足 tag 条件。
- 现有六份离线 packaging guard：35 passed、27 subtests passed、1 skipped；唯一 skip 是未提供经过校验的可执行 NSIS compiler cache，不新下载、不假称真实编译/Windows安装。覆盖锁/source drift、native 许可映射/未知材料、路径/归档逃逸、UCRT 来源、合成 workspace 保留及 NSIS 清单约束。
- 原实际 production runtime builder **exit1**：`/tmp/windows-candidate-channel-runtime.log` 指向 `dist/film-export-qc-runtime.js` 的动态 import，原 graph guard 拒绝所有非字面量运行导入。main QC loader 虽使用既有可信资源根的固定 `index.mjs/media.mjs`，本片不绕过该 guard，也不把部分输出当成功运行包。下一窄片需明确审查固定资源闭包后才能构建候选；SDK/单模块 require 不能替代这项生产 builder。最终真正 Windows 安装/字幕/卸载结果须来自 root 后续推送的同一完整候选。
