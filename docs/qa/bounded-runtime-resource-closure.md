# Production runtime 与固定收集资源的实际闭包

本片修复真实 production builder 的打包阻断，不改 main loader、QC/混音/归档/配声算法、许可/签名/TLS/发布审批。基线 1035/0f 的原 builder 在 `film-export-qc-runtime.js` 非字面量 import 退出 1，完整原日志 `/tmp/windows-candidate-channel-runtime.log` 保留；不是 SDK44 已 require 就可忽略的故障。原 emit 实际共有六处此类导入。

## 验证边界

- `--resources-root` 必须是当前候选实际 collector 输出：Windows 已经 `verify_frozen` 的 frozen/resources，或 Linux 包的 qc/project-archive/compiled audio-library 根。没有该参数/目录不继续；没有 raw-source loader fallback。
- `config/desktop-runtime-resources.json` 是 checked-in 依赖审阅，不是发行/媒体授权：绑定四个原 loader 的完整源 SHA、规范 LF emit SHA、六个具体函数/callsite 与固定资源角色。每个动态 site 仍审核，文件名相同但代码/入口不同仍拒绝；其他非字面量 require/import 继续拒绝，不跳过整个 JS。
- 九个实际 mjs 必须匹配已审 bytes/source-lock；library 三模块和整个实际 resource-index 还与固定 source pins 交叉核验。同目录自写自洽 SHA 清单不能引入新 module。所有已列 Ogg/许可证/来源文件逐一 SHA，未列文件/目录、symlink/junction、缺项/越根和未知依赖失败。
- CJS graph 保原隔离 Node resolution/应用根包含检查（统一 native realpath 身份）；ESM 相对依赖只接受固定闭包，picker query SHA 必须等于实际 synonyms bytes。最终重核源、emit 和资源，receipt 给当前 review/source/loader SHA、九模块、470 文件与实际 host modules，`authorization:false/release_approved:false`。
- Windows main packager给 builder 真实 frozen 根，拷贝到 stage 后再用相同 verifier 核实际目标，产出 STAGED-RUNTIME-CLOSURE.json；两个 Linux packager原编译/collector后复用同一 CLI，不重复编译、不开第三套 collector。

源改动/编译器或已审模块变化需要重新审阅并更新声明，不能自动改 self-hash 放行。原 FROZEN/native 材料、未知 DLL failclosed、工具 pin、签名与 tag 发布条件全保留。

## 实测

- 实际原 Windows collector收集 QC5/archive1/library464。完整 production builder 已成功，首次输出 `/tmp/aivora-bounded-runtime-app-first` 与 `/tmp/bounded-runtime-builder-first.log`；仅 Electron/Windows/installer 标 NOT_RUN/NOT_BUILT，不报安装成功。
- `node --test scripts/build-runtime.test.mjs` 最终 9 项全部通过，`/tmp/bounded-runtime-final-nine.log`。保原真实 ASAR/显式声明保留/完整 SDK CJS+ESM 44 导出/排他输出/不收测试文件断言；实际调用所有六 loader，加载 catalog206。
- 对抗包括同目录 module+index 自洽篡改、同名 loader 改入口、任意新增 dynamic、缺 flag/root/module、额外私有文件、junction 逃逸；纯真实 parser拒未知 bare/HTTP/越根/nonliteral 依赖。两个原 Linux collector实际收集出 portable 布局，与 Windows收集的闭包 SHA 全一致。
- 原 packaging 与三 collector Python 回归：45 passed、27 subtests passed、1 skipped（缺经过校验的 NSIS compiler cache，原 skip，未新下载或执行 Windows安装器）。命令为 `python -m pytest packaging/windows/test_build_prerequisites.py packaging/windows/test_dev_core_packaging.py packaging/windows/test_readiness_audit.py packaging/windows/test_frozen_smoke_workspace.py packaging/windows/test_system_ucrt.py packaging/windows/test_nsis_core_installer.py services/api/tests/test_export_qc_resource_collection.py services/api/tests/test_project_archive_resource_collection.py services/api/tests/test_audio_library_resource_collection.py -q`。
- 旧树首轮缺 @electron/asar/app-builder-lib，仅 2/4，通过原 npm lock、ignore-scripts 安装后再跑 9/9；保 `/tmp/bounded-runtime-original-runtime-tests.log`，不当产品断言失败。首 ESLint URL/Buffer no-undef 也保原日志，已显式导入 Node URL/Buffer，最终目标 ESLint/Python Ruff/format 均0。
- 旧可执行 readiness 指引已补真实 `--resources-root`，不保留无效命令。没有改 API/native业务源，未重跑全库；SDK 与 builder 不替代真正 Windows候选安装/升级/人工观看听验。

Git 树冻结后再用同一实际 collector根重建独立 production app，以该固定 HEAD/receipt 为最终可复核产物；root随后独立复核。Windows候选尚未触发，集成 reinstall 实机验证为下一独立片，不拿旧 media-free升级收据替代。
