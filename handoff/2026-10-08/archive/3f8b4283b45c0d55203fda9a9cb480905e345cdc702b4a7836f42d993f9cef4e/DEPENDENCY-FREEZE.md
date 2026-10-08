# core153 导入门依赖来源冻结（静态，未复制）

来源为 QA03 R2-only build 自有 `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-r2b2\run-01\venv\Lib\site-packages`。QA03 `MGR02-APPROVAL.json` SHA `61EF4D6D0EF8CEAC4282FAEC8CC7539E1B6A981C34DC1DFF41F4739970485719` 的批准范围为 R2 lock-only EXE build；其 `run-01/RECEIPT.json` SHA `1ED80F0B830E6942F1B4EE35DB00A591521E58A2F04C4649A112A5AAFED9F9D0` 为该构建收据，**不自动授权 core153 导入**。CTL 已允许当前任务只读取件及准备 QA 自有目录复制；复制仍须 MGR01/MGR02 对具体源、目标、runner 与 packet 单签。

静态 AST 对 core153 最小 9 个新增/替换模块的递归 `aijian_api` 闭包为 56 个模块；直接第三方根仅 `pydantic`。依其 QA03 venv `METADATA` 中非 extra 的 `Requires-Dist` 递归解析，固定 5 个发行包；每个 `RECORD` 列出的文件已用固定 uv Python 实读 SHA/bytes，实际 package/dist-info 目录与清单完全相等（157/157，无未记录文件），PowerShell 对同一 157 个源文件的 SHA 也逐项一致。完整绝对路径、版本、文件 bytes/SHA、METADATA 与 RECORD SHA 见 `DEPENDENCY-CANDIDATE.json`，SHA `DCD7BF0BF0FB29B7A1247C33C62B4470AD15A89AB8658CC4845E84E7FDAE6AC7`。

| 发行包 | 版本 | 文件数 | 字节数 | WHEEL tag | METADATA 许可 |
| --- | --- | ---: | ---: | --- | --- |
| annotated-types | 0.8.0 | 10 | 36,767 | py3-none-any | MIT |
| pydantic | 2.13.4 | 114 | 1,893,093 | py3-none-any | MIT |
| pydantic-core | 2.46.4 | 13 | 5,599,991 | cp312-cp312-win_amd64 | MIT |
| typing-extensions | 4.16.0 | 8 | 183,196 | py3-none-any | PSF-2.0 |
| typing-inspection | 0.4.2 | 12 | 54,040 | py3-none-any | MIT |
| **合计** | | **157** | **7,767,087** | | |

五份 LICENSE 均在这 157 文件内，分别有逐文件 SHA；`pydantic_core/_pydantic_core.cp312-win_amd64.pyd` SHA `775BCB0CE04B93CB18410BB28E589E1DD6A441F1F93007D2DC80A305D70C74C9`。固定基础 Python 是 CPython 3.12.13、AMD64、cache tag `cpython-312`，SHA `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`；其扩展后缀列表含 `.cp312-win_amd64.pyd`。这是静态 ABI 匹配，尚未加载 `.pyd`。

QA03 site-packages 另有 `_virtualenv.pth` SHA `69AC3D8F27E679C81B94AB30B3B56E9CD138219B1BA94A1FA3606D5A76A1433D`（`import _virtualenv`）与 `distutils-precedence.pth` SHA `2638CE9E2500E572A5E0DE7FAED6661EB569D1B696FCBA07B0DD223DA5F5D224`（distutils shim）。这两项不在 157 文件清单内，不复制、不执行；不复制 QA03 其余 26 个发行包、venv 解释器、`sitecustomize` 或产品源码，不运行 `site.addsitedir`、venv 激活、安装或下载。候选包内相关 `.pyc` 为 0；QA03 site-packages 无 `aijian_api` 目录。

目标仅为尚不存在的 QA 自有 `core153-import-gate-prep-01\qa-deps`。复制门执行后，固定 Python 与独立 reader 的目标视图仍需分别核对；源 157 项跨 reader 一致不能预推目标一致。
