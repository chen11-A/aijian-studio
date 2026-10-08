# 本机 Sub2API 新隔离 QA 取件方案（静态审签稿）

状态：`PLAN_ONLY`。`STAGE-PLAN.json` 固定输入与预计数量，不授予复制、生成、迁移或产品运行权限。QA03 是新 stage 的唯一写者；其 ProductionBrief r2 门完成或冻结停止、MGR02 独立审签后再取件。当前建议根 `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-stage-01` 不存在。

## 完整基底与覆盖

1. 在新根 `source/` 按 W0-v3 `source-03` 收据/FILES 清单复制 13,681 个常规文件和 771 个**相对、目标留在新 source 根内**的符号链接。逐项源前 SHA/大小与目标后 SHA/大小、链接目标/解析目标比对；禁止跨树软链接或作者树回退。旧 source-03 本身不改。
2. 从 QA03 S2 已固定包的 `source/services/api/` 拷 185 个 API 源文件，再拷 `source/pyproject.toml` 与 `source/uv.lock` 两个根文件，共 187；按 `INPUT-MANIFEST.json` 的逐件哈希核。该包另有 2 个旧 desktop、1 个 packaging 和 4 个 work 文件，**不**覆盖 W0-v3 desktop、packaging 或工作记录。W0 与这 187 路径交集为零。
3. 将 S2 包 `deps/` 的 596 个文件、20 个 distribution 拷到新 stage 的独立 `deps/`，作为 Python QA 依赖输入。S2 来源 HTTP PASS 只证明其旧组合的运行；新组合须重新核 import `__file__` 和实际读到的依赖闭包。Node 依赖沿 W0-v3 的 771 个内部链接复制，不能解析回旧根。
4. 按 `COMPOSITION-INPUTS-v2.json` 覆盖 24 项（DEV01 5、DEV05 11、DEV07 3、DEV04 5）：23 项替换基底、1 项新建 `provider_origin_mode_schema.py`。每项写前核基底 SHA/缺件状态，写后核候选物理源 SHA/大小；DEV01 使用**隔离 after 快照**，不能改读作者树旧 repository；DEV05 用固定 Python consumer 核 E-SafeNet 视图。
5. 另拷 `scripts/export_openapi.py` 作者源 4,903 字节/SHA `C0707D4C719C347667113222FF7211AC4EA00132A89D6F4EB19A2159300F3F5E` 到新 source 根，这是上述两个基底都缺的生成器输入。生成前预计 source 常规文件 13,870、内部链接 771，deps 596。`packages/contracts/openapi.json` 和 `src/generated.ts` 此时仍是旧 hash `DA0332EB` 与 `EF283C66`，不得称本机 mode 合同已生成。

QA03 应在独立目录保存复制脚本、源/目标清单、每一步前后 SHA、链接解析、读入 `__file__`、无外部文件读取与 stage 外写入审计。新 stage 未建，数量为静态推算；实际结果必须重新签收。旧 W1/W2 PASS、S2 HTTP PASS、Migration31 G1/G2 与 c19/B31 证据均不转移。

## 生成器副作用与单独门

仓库根 `contracts:generate` 实际为 `uv run python scripts/export_openapi.py && openapi-typescript packages/contracts/openapi.json -o packages/contracts/src/generated.ts`。直接运行 `uv run` 可能创建/改写 `.venv`、缓存或解析依赖，因此不纳入未审签的 stage 复制。建议 QA03 在 MGR02 **单独签准生成**后，用固定 Python、隔离 `sys.path` 和已拷 20 distribution 在新 source 内执行固定脚本，再用 W0-v3 内 `openapi-typescript@7.13.0` CLI、固定 Node 和网络拒绝 shim 对新 `openapi.json` 生成 `generated.ts`。先固定 `package.json`、脚本、CLI/依赖及进程身份；执行前后仅允许这两个输出路径变化，任何其他变化或网络/Vault 调用立即停止并留原始证据。源码 `export_openapi.py` 默认声明只写 `packages/contracts/openapi.json`；`--source-manifest-review` 分支会写第三处 desktop schema，不得在此门使用。

静态审查看到 exporter 导入 `aijian_api.main` 并调用 `create_app(...).openapi()`；`main.py` 顶层另有 `app=create_app()`，其构造会创建 `SystemCredentialVault` 对象，仓储入口为惰性工厂。**静态代码不能证明零副作用**。生成门须独立 spy/阻断 Vault get/set/delete、provider/HTTP、socket/DNS/proxy/redirect，固定隔离 profile 和 QA 路径，记录调用次数均为零；对导入文件做 `__file__` 收敛审计。实际依赖闭包与生成器执行尚未验证。

Migration32/33 升级/回滚和 G4/G5 凭据轮换状态机仍是各自独立门。生成合同成功也不等于本地网关服务已部署、Electron/EXE 或产品验收。c19 写窗关闭。