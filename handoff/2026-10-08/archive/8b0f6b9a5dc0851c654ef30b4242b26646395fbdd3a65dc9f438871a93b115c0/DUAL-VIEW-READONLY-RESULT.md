# core153 G0 只读双视图复核（2026-09-29）

结论：固定 uv Python `-I -B` 的 **consumer copy/readback 为 PASS**（153/153 源与 QA 目标 bytes/SHA 均等于固定清单）；同一 QA 目标路径在 PowerShell 7.6.5 下呈现另一组字节，153/153 目标 SHA 与清单及 Python 读值不同，但 153/153 长度相同。跨 reader 视图差异尚未归因。不能声称物理磁盘原始字节与明文 SHA 相同，也不能把 Python 视图 PASS 扩写为模块导入或 `__file__` 消费通过。停止后续门，不重试、不导入。

## 原始读取命令与身份

目标首件绝对路径：

```text
C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\core153-g0-copy-gate-01\qa-physical-package\aijian_api\__init__.py
```

PowerShell 命令（实际使用的读取表达式）：

```powershell
$p='C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\core153-g0-copy-gate-01\qa-physical-package\aijian_api\__init__.py'
$i=Get-Item -LiteralPath $p -Force
$b=[System.IO.File]::ReadAllBytes($p)
(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash
[Convert]::ToHexString($b[0..15])
(Resolve-Path -LiteralPath $p).ProviderPath
```

实际 PowerShell 7.6.5 进程为 `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`，可执行文件 SHA-256 `362A356CE7F0940EC74F73A8FC2C990A2CC24A38A11C90BBD8ECA947110AD139`。

固定 Python 命令（同一路径；执行的是只读表达式，未导入产品模块）：

```powershell
$p='C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\core153-g0-copy-gate-01\qa-physical-package\aijian_api\__init__.py'
& 'C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe' -I -B -c 'import hashlib,json,os,pathlib,sys;p=pathlib.Path(sys.argv[1]);b=p.read_bytes();s=p.stat();print(json.dumps({"path":str(p),"resolved_path":str(p.resolve()),"realpath":os.path.realpath(p),"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest().upper(),"head16_hex":b[:16].hex().upper(),"is_symlink":p.is_symlink(),"is_junction":p.is_junction()}))' $p
```

固定 Python 可执行文件 SHA-256 `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`。

| 同一目标 `__init__.py` | PowerShell | 固定 Python / 清单 |
| --- | --- | --- |
| bytes | 56 | 56 |
| SHA-256 | `F3F3A9D35E7679C36EFB52E4B85F4A8010E1533F1A343663857F239E5E47B10B` | `333A85461A874678AC3C4FA0ABF4AE0F415BAAB2015384C85976E7EE42690D2A` |
| 头 16 字节 hex | `7714236508003000F09C2E567C775576` | `22222241696A69616E2053747564696F` |
| 路径/属性 | `Resolve-Path` 与输入相同；Archive，非 link | `resolve`/`realpath` 与输入相同；非 symlink/junction |

153 项聚合只读结果：两份记录的 target 顺序、绝对路径和解析路径 153/153 相同；长度 153/153 相同；SHA 和头 16 字节 153/153 不同。PowerShell `Get-FileHash` 与其 `ReadAllBytes` 自行计算的 SHA 153/153 相同，全部属性为 Archive、无 link；Python 153/153 无 symlink/junction。逐项原始读值见 `DUAL-VIEW-POWERSHELL.json` SHA-256 `E008496B5C2077F90BFC3FBF6B3FF16A0CCF972C400C7EC613147DB010DC7B18` 和 `DUAL-VIEW-PYTHON.json` SHA-256 `373AA4753123AF2FD729E6E2C9D891244F3AA73738C5D1384BC842E671EBE7AA`。这两份 JSON 位于 packet 根，未修改目标包或 `run-01`。

## 历史保护视图的最小对照

对既有受保护快照 `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-workspace-owner-lock-longpath-candidate-1\workspace_owner_lock.py` 使用上述同类 PowerShell `Get-FileHash`/`ReadAllBytes` 与同一固定 Python `-I -B Path.read_bytes` 只读对照：两侧 realpath 相同、长度均 6,672、无 link；PowerShell SHA `01CE52C9D06B827A2F1127179CFADEEED798ACECA5C94F85E163C37F1855610C`、头 `621423654700B90100000001452D5361`（含 `E-Sa`）；Python SHA `103ED055A19839179977C6792E58619E71ADF724037560106837DCA9B798D427`、头 `22222250726F636573732D6C69666574`。QA 目标与该已知快照的 PowerShell 头都含 `14 23 65` 字节序列，呈现相同类型的双视图现象；仅凭本次读取不能确定目标写入/读取变换的内部机制。

同一 D152 源 `aijian_api/__init__.py` 作为对照，PowerShell 与固定 Python 均读到 56 bytes、SHA `333A85461A874678AC3C4FA0ABF4AE0F415BAAB2015384C85976E7EE42690D2A`、头 `22222241696A69616E2053747564696F`。因此差异发生在本次 QA 目标视图，不是这份源文件的跨 reader 差异。

## 保留与边界

原 `run-01/RECEIPT.json` SHA `D141C4D5C4159A65264938733D95EA5AD181BC9228F36C646F53DC551125A312`、外层 `OUTER-EXIT.json` SHA `1B3FB2557E02635A428FCAD44C95409C5727AEE2FE9FC6C058AA98C2234B7A15`、先前 `POSTFLIGHT.json` SHA `A4373E4DCE4AC52FE4EB33686F74DE677EC7349A692459B9C7696447A423591F`、`GRANT.json` SHA `E0903CBED6B61DC5F9EEE3FA4E2B718A01F9A70AFC8AFC2E67F89D6DB071F5C0` 均保留。`POSTFLIGHT.json` 只证明固定 Python 同视图回读，不能独立证明跨 reader 一致。未改动/删除目标包、`run-01`、外层原始输出或 GRANT；未重试、导入、迁移、rights、claim、EXE、provider 或写 c19。
