# core153 顶层导入与第三方依赖静态审计

状态：只读 AST/元数据审计；未导入 `aijian_api`，未启动服务。审计使用固定 uv CPython 3.12.13 `-I -B` 对清单中 153 个源文件逐一 `ast.parse`，153/153 可解析；此项不证明导入可执行。

| 直接外部根包 | 静态引用目标数 | 固定基础 Python 的发行版元数据 |
| --- | ---: | --- |
| `fastapi` | 26 | 未安装 |
| `pydantic` | 62 | 未安装 |
| `keyring` | 1 | 未安装 |
| `uvicorn` | 1 | 未安装 |

此处只统计 153 文件 AST 中直接的绝对 import 根包；传递依赖、动态导入与实际解析路径未钉住。元数据查询未执行包导入。固定基础 Python SHA-256 `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`，不能以作者/c19 venv 或 sys.path 补缺。

具体顶层执行点：D152 `aijian_api/main.py` SHA-256 `81C1F2FE18B16D4EE9EAEDE7DD96DA60856400E51B6D8187C0741B26DA086AFC` 第 1143 行执行 `app = create_app()`；`create_app` 自第 257 行构造 FastAPI app，并在第 1062–1137 行注册路由。`aijian_api/sidecar.py` 的 `run()` 位于第 357 行的 `__main__` guard 下，但其顶层导入 `main`，因此普通导入 sidecar 也会触发 main 的顶层 app 构造。`credential_vault.py` 顶层导入 `keyring`，本次未执行其调用。其他模块的装饰器、类定义、默认参数和常量初始化也可能在导入时执行，未逐一证明无外部副作用。

结论：导入/`__file__` 门当前**不能独立签门**。第三方依赖的 QA 自有锁定环境缺失，且顶层 app 构造的副作用边界未核完。当前 packet 仅含 G0 复制与实际 Python 前后 bytes/SHA 回读；不导入任何产品模块，不将该门 PASS 扩写为消费、运行时或产品验收。导入门需另行固定依赖、审顶层副作用并获得独立授权。
