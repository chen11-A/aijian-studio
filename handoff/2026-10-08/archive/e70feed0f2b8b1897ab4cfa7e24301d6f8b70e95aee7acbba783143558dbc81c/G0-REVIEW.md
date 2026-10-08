# B31 G0 身份门静态复审包 02

状态：**静态就绪，未运行，未获授权**。旧 prep-01 原样保留；本目录是独立修订包，供 MGR01 复审，随后由 MGR02 对本门另签一次性 GRANT.json，写明 approval_id。当前无 grant、ATTEMPT-USED、run-01、launch-01 和 DB。

## 冻结输入

- PACKET.json SHA-256：395938A6EF1EA37B1EA9D898C3DAF93F0CCE20B82A3C50B1ECA28A8953DA3FC5；固定解释器 consumer g0_once.py SHA-256：87AA53454A5198A02E262162F7C91BA9908C396F26F9033618FA70C41E3EC33B。
- launch_g0_once.ps1 SHA-256：BBC068F497B7384B34B972CA72470A084EBCDA2EF698A395EE4F35FA44A31DFF；LAUNCH-PACKET.json SHA-256：CEA5421A5F65A1152259C2696B35696190A84DEB319AC14C2228C33FF8AD193A。
- PROFILE-PREPARED.json SHA-256：A16205BADAA4C25D504FD0AB5D7556CDDB64445CE0240086768D913A44769B49；HASH-PROBE-STATIC.json SHA-256：6C9624E167CA9F94FCF2704BCA3CF421B92F3E1ED65626E8B993FF31204A8092；STATIC-NEGATIVE-CHECKS.json SHA-256：A91DA85412F2DD8BC676250E539CA696C256EC23D779A5140C12E4C50C774920。
- B31 QA 物理包 153 件、隔离依赖 157 件，逐件固定哈希；固定 CPython 3.12.13 -I -B。

## 单次边界

仅在固定 GRANT.json 存在后，launcher 立即以 FileMode.CreateNew 独占写 ATTEMPT-USED.json 并落盘；随后才进入同一 try/catch 内检查参数、目录、packet、授权、工具、profile、清洁 8 变量环境及隐藏哈希探针。已有 attempt 标记会阻止同目录重进；任何预检 RED 也已消耗本次机会，写 ATTEMPT-RED.json，并保留 launch-01/RED.json（若目录已建立）。runner 要求该标记、PREPARED.json 和 grant 对 launcher/launch packet 的哈希绑定。

隐藏子进程的超时回收、Kill(true) 后 WaitForExit 与双流收尾均使用有界等待。stdout/stderr 直接写独立原始 .bin 文件，记录 PID、退出码、kill/流异常与完整性；未退出或流不完整一律 RED，不把不完整输出称为清洁退出。成功回执仅为 PASS_B31_G0_CONSUMER_IDENTITY_IMPORT_ONLY，不建库、不迁移、不访问 Vault/provider。

## 静态核验及边界

runner AST 和 launcher PowerShell 解析通过；153/157 逐件哈希通过；纯数据/静态负例核了旧 attempt 拒绝、错误哈希、无无界 Wait、首 RED 和原始流留存。G0 尚未启动，无法据此声明运行 PASS。G0 实际 PASS 回执的 SHA 须另经审核，才可签 G1。G2 13 步故障回滚仍为独立后续门。
