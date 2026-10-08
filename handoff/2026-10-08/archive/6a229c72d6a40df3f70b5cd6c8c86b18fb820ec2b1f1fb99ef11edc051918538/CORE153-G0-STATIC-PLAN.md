# D repo30 core153：G0 隔离消费门静态准备

状态：仅准备计划与固定输入；尚未建立 QA 物理包，尚未执行模块导入或 G0。日期：2026-09-29。

## 固定边界

- DEV08 最终 `TARGET-MANIFEST.json`：`C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp\work\dev08-d-repo30-core153-integration-20260929\TARGET-MANIFEST.json`，SHA-256 `262C485F782D7B685DDD3D32ECF190DD2DF5B2E6008D9644EF0F6EAFD25E0E64`，`readiness=SOURCE_PATHS_PINNED_CONSUMER_AND_FRESH_QA_PENDING`。
- D152 基线 `FILES.json`：`C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-d-repo30-qa-closure-152-1\FILES.json`，SHA-256 `F3775529D3D431D5D914F80FB74552CD23B96402142808970963D75C296160E9`。最终 D153 为 144 保留、8 替换、1 增补；153 个唯一目标及 153 个唯一源，全部在 `aijian_api/*.py`，总字节 1,892,728。repo30 `repository.py` SHA-256 `C21049176963798A3D0DE0748EAFD5FF41F0294C759939A31BDFD694C5C43DD8`；不引入 repo31。
- 实际源读取固定输入：同目录 `CORE153-G0-FIXED-INPUT.json`，SHA-256 `AAC037375F751B7B02949540B7D8E354AE31AE18B76C995DC9D2C68A55334C3C`。它逐项记录源路径、预期/实读 bytes 与 SHA，不含源码字节。uv CPython 3.12.13 `-I -B` 仅读源 153/153 一致；这不等于 QA 包消费者回读。其基础解释器为 `C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe`，SHA-256 `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`；当前 `sys.path` 仅基础解释器目录及其 site-packages，无作者/c19 源码路径。
- c19 清单比对 127 相同、3 不同、23 缺失是 MGR04/DEV08 的只读版本边界，未在本次写入或补齐；c19 写窗已关闭。保留 D 编码器 `6DB` 与 service `A241`；此清单不证明长路径正式编码、EXE、运行时或 provider。

## assembly 2E / probe 消费缺口

- `episode_media_assembly_store.py` 采用现有 `20260928-dev06-plaintext-copy-probe-1` 明文 probe 副本，19,525 bytes，SHA-256 `2E18464BAE6D0DC07383A4A15CDC804999F15F73D12B2974BF727089AADCC610`。它静态导入 `media_asset_probe_store._from_row`、rights 历史等；`product_export_claim.py` 静态导入其 `_validate_script_refs`。probe store 固定为 Resolver54 `38CD2EEC6E1BE39620773EFD9D3917A1E93951A86C9CC473E7BB304B9A50CCFA`。清单的 9 个改动/新增文件静态绝对导入均指向 core153，但动态导入、加载顺序及实际消费者 `__file__` 未验证。
- 清单里 153 个 `consumer_readback` 与 `consumer_module_file` 均为 `PENDING`。`main.py`/`sidecar.py` 的本次目标静态搜索未见 assembly/probe 引用，公开路由与认证 wiring 是后续独立门。2E 明文副本与已有静态引用只能支撑 G0 设计，不能称其已在目标应用被消费。
- DEV05 lock 以作者确认的明文源 `103ED055A19839179977C6792E58619E71ADF724037560106837DCA9B798D427` 为唯一源。保护态快照 raw `01CE52C9...` 是双视图异常，不能复制保护原件或用 raw 快照替代明文身份。若批准建包时任一读取视图或 SHA 偏离固定输入，立即 RED 停止并留原始证据。

## 提议的 G0 一签隔离门（待 MGR02 与 MGR01 核范围）

1. 在新批准的 QA 专属物理目录，逐项按固定输入路径读取、核 bytes/SHA 后才写入对应的 153 个目标；绝不从 c19 或作者包做缺件 fallback。只复制经实际消费者读取确认为固定明文 SHA 的源。每个目标先校验相对路径、唯一性与目标目录约束；如受保护双视图、缺件、权限或 hash 漂移出现，首 RED 停止，不继续补包。
2. 固定基础 Python 的绝对路径、文件 SHA、版本和 `-I -B` 标志；门启动、复制前、消费前、消费后分别记录其 SHA 与 PID。消费前/后均由这个实际解释器对 QA 物理包 153 个文件逐项重读 bytes/SHA；任一差异首 RED 停止。若第三方依赖需环境，先单独锁定 QA 自有环境及依赖，不借作者/c19 源码路径或其 venv 作隐式 fallback。
3. 仅将 QA 物理包根加入隔离进程 `sys.path`，记录完整 `sys.path` 前后值并拒绝作者与 c19 源码路径；确认 `aijian_api` 包和本门导入的每个模块的实际 `__file__` 都解析在 QA 物理目录，且与对应目标文件一致。先审顶层导入副作用和依赖，再执行限定的一签导入；任一模块逃逸、导入错误或副作用越界均首 RED 停止，保留 stdout/stderr、退出码和解释器/包哈希。
4. G0 只接受物理包身份与导入闭包。G1 repo30 迁移、G2 路径边界、G3 rights/probe/assembly、G4 claim/runtime、G5 公共路由分别需后续授权与独立验收。G0 PASS 不自动升级为产品、迁移、EXE、provider 或最终验收。

## 本次停止点

当前仅有清单 SHA、基线 SHA、153 个源文件固定输入及静态消费者关系。未复制 E-SafeNet 保护原件，未创建 QA 代码包，未导入 `aijian_api`，未启动安装、迁移、rights、claim、EXE、provider，也未写产品或 c19。等待 MGR02 与 MGR01 共同核定 G0 新包范围和一次性执行授权。
