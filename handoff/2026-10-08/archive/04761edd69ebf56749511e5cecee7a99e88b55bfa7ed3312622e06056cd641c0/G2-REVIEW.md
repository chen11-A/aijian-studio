# B31 G2 prep-03 静态复审包

状态：**未授权、未运行**。仅供 MGR01 范围复审，MGR02 独立单次签发前不得启动。旧 prep-02 的授权已经消耗，RED、marker、launch-01 原样保留，不能重跑。

## 旧尝试与修正

- prep-02 POSTRUN-REVIEW.json SHA256 `BA0DAE1F6F8EE7A52E26A47F032BAC3897A7F1F8E75136D17432C0347C5D0A30`；FAILURE-SHELL-ADDENDUM.json SHA256 `2548141FBBBA45B084DE1EA5787B7029F86232C5B5F47AC5B5F5359EAEA9097E`。
- 旧 marker `1E01000B02E3A6DFA6629EEA3A950995003D1262A434211D817A967812616CE6`，ATTEMPT-RED `DCCB4C1E59F024CC32CA7189067E3C7F58593AB0A87517C389FE7C76E1BA0ED8`，launch RED `1A83BA8BBF6D3BD6FD30DBB8E6692121A9A4EE3CFD0B3B297DE637988617B639`。Windows PowerShell 5.1 在 `ProcessStartInfo.ArgumentList` 处报错，hash probe 与 G2 子进程均未启动。
- 新包固定实际 PowerShell 7 可执行文件、哈希、版本及调用参数；launcher 在使用 `ArgumentList` 前，核对当前进程路径、可执行文件 SHA256、版本及该属性。上述检查在 claim 后的受控 try/catch 内；异常写 ATTEMPT-RED，不能重试。

## 冻结对象

- PACKET.json `AC58956E842ACEA957A4DE230901C8AC081C57DA6761D958609D858F54AC749A`
- g2_once.py 固定 Python 消费者 `A27780579CE10C4972DAF877DBEAEB6E509AA0093C5C7BF21672E365D3F1606C`
- launch_g2_once.ps1 `760AD43B38FA1AF7F01FAFF362E8A047DB342C5A9DB11DD469C518667A7C1AF4`
- LAUNCH-PACKET.json `75CCB5514A4D055D35FAD51200497EA92C97B416D5031FCC34113EF5F55A8BF0`
- SHELL-PROBE-STATIC.json `BF3A4FE6B2CBA7F5D03B84494506CE8E6DA3108A48C2E07E10E97A24BF943604`
- STATIC-NEGATIVE-CHECKS.json `778904058CA499C3E9317FBE08F186CF743D27CB6BDBB81724CE1620297FAA4F`
- STATIC-REVIEW.json `6D51EA807E23CBEF298A75D2445CD730F601731E93EDDB45E90A023CC23B95FA`
- PowerShell 7 路径 `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`，SHA256 `362A356CE7F0940EC74F73A8FC2C990A2CC24A38A11C90BBD8ECA947110AD139`，版本 `7.6.5`。

准确调用方式（仅用于新授权后的单次运行）：

```text
"C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" -NoProfile -NonInteractive -File "C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\b31-g2-rollback-prep-03\launch_g2_once.ps1"
```

## 静态核验与运行边界

- 固定 Python 哈希核对 packet 所引八项引用、G1 seed、153 个产品文件和 157 个依赖文件；23 项静态 pin 检查全通过。runner AST 解析通过，PowerShell parser 0 错误。
- PowerShell 7 进程只读探针确认路径、哈希、版本及 `ArgumentList` 存在。纯源码顺序和数据模型负例覆盖旧 marker/RED、claim 创建/写/Flush 失败、错误 shell/API 和完整 claim；没有执行 launcher 或故障回滚。
- 当前 profile 4 个空目录、0 文件；无 GRANT、ATTEMPT、launch-01、run-01、DB 副本。13 个 fault case 仍仅为计划，G2 结果未知。
- 新 GRANT 须绑定此 packet/runner/launcher/launch-packet 的哈希、G1 receipt、`launcher_shell_path` 与 `launcher_shell_sha256`，并明确 MGR01 范围审 true、MGR02 单签及 B31_G2_13_STEP_ROLLBACK_ONLY。
