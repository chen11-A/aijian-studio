# core154 reader 物理复制：静态复审包

状态：`STATIC_PREPARED_NO_COPY_NO_IMPORT`。本包只供 MGR01/MGR02 独立复审；`GRANT.json`、`run-01`、`launch-01`、目标实体包均不存在。当前没有 core154 复制或 reader 导入/行为验收。

## 冻结输入

| 项目 | SHA256 |
| --- | --- |
| DEV01 `PROPOSAL.json` | `D4E2D1650F05B027FD6C625F9A701E7AE8C1AA404DCA225AC787F597F9672E37` |
| core153 `TARGET-MANIFEST.json` | `262C485F782D7B685DDD3D32ECF190DD2DF5B2E6008D9644EF0F6EAFD25E0E64` |
| QA01 core153 `POSTFLIGHT.json` | `A4373E4DCE4AC52FE4EB33686F74DE677EC7349A692459B9C7696447A423591F` |
| Resolver54 `FILES.json` | `FB7B477C6BC5EEAF6DCA4D1A970275062ED658C0EFF6F3998AE1D73D9A537B72` |
| 新 reader | `BF38C626440888D474872C8C7E6093EC96F41B0211A66EAE1870A8B6D52EE676`；8,905 字节 |

153 个 retained 文件只来自 QA01 现有 `core153-g0-copy-gate-01/qa-physical-package`，新 reader 只来自提案所指的 Resolver54 冻结快照。静态预检对源实体包逐个核对 SHA/字节，并核对无多余文件、`.pth` 或重解析点；154 个源文件均通过 Python AST 解析。没有从 live author 或 c19 取文件的回退路径。

## 待复审执行字节

| 文件 | SHA256 |
| --- | --- |
| `PACKET.json` | `FE5292DAF03A1ADE6B15259E3E4419BFF727C0B22C4ECACAD574C340FB8F204E` |
| `copy_once.py` | `51D5DBDDEF7A38B8BC00F21114414FDBB15694B1A462A1AB28EB6EA603BF37EA` |
| `launch_once.ps1` | `DECED71A25A7ECB43CEFC07A2A1A61FB125C731C82D91591EBF818398D1AF393` |
| `PRE.json` | `3628FE18455953C7B981D64F8EB998CED4ECAA98822AFADB1287FC5260EB2A45` |

固定 Python 3.12.13 为 `C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe`，SHA `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`；使用 `-I -B`。Python 与 PowerShell 对上述三个执行字节的 SHA 回读一致；Python AST 通过，PowerShell 解析错误 0。

## 输入和输出预算

- 新包目标：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-core154-reader-copy-20260929\qa-physical-package`。仅 1 个 `aijian_api` 子目录、154 个 `.py` 文件、1,901,633 字节；最长目标文件路径 233 字符。
- 单次执行记录：本控制目录的 `run-01/RECEIPT.json`；隐藏启动记录：`launch-01/{stdout.txt,stderr.txt,EXIT.json}`。首次异常另写本控制目录的 `RED-STOP.json`，保留原始错误，不自动重试。目标包、run、launch 三处执行前均必须不存在。
- 执行器先核对 grant、packet、runner、launcher、解释器、proposal、base manifest、reader manifest，再完整回读 154 个源文件；复制时逐文件复核；完成后完整回读源 154 与目标 154，并验证三份 SHA/字节一致、目标无额外文件、链接、`.pth`。回执只承诺 `PASS_COPY_READBACK_ONLY`。
- 本门禁不导入产品模块、不运行 reader 行为、不写 c19、现有 core153、作者树、数据库，不调用 provider。`__file__` 和 reader 行为需另签门禁。

## 单次 grant 要求

MGR01 复审范围后，MGR02 若批准物理复制，应由其明确给出与当前 packet 相绑定的单次 `GRANT.json`，至少含：

```json
{
  "status": "APPROVED_SINGLE_RUN",
  "approval_id": "MGR02-CORE154-READER-COPY-20260929-01",
  "packet_sha256": "FE5292DAF03A1ADE6B15259E3E4419BFF727C0B22C4ECACAD574C340FB8F204E",
  "runner_sha256": "51D5DBDDEF7A38B8BC00F21114414FDBB15694B1A462A1AB28EB6EA603BF37EA",
  "launcher_sha256": "DECED71A25A7ECB43CEFC07A2A1A61FB125C731C82D91591EBF818398D1AF393"
}
```

上面仅是复审所需字段，不是已签发的 grant。复制若获单次批准，启动器应只调用一次；出现任意 RED 即停止并升级，不重启、不自动补拷。物理复制回执通过后，consumer `__file__` 与 reader 行为仍要分别获得授权并独立验证。
