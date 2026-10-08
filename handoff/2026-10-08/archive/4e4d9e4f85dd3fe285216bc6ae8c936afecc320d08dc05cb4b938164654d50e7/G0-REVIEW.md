# B31 G0 身份门静态交接

状态：**静态包就绪，未运行**。须先经 MGR01 范围复核，再由 MGR02 对 G0 单独签发一次性 GRANT.json。当前无 grant、run-01、launch-01 或 G0 回执。

## 固定输入

- 目标：B31 QA 独立物理包 153 件，确切 150 保留、2 替换、1 新增；依赖包 157 件。PACKET.json SHA-256：4C22073EE795E9623BEFF917AB1AD3C267BCCCA1A5B27E4ACDE1F9F0FF4B11C8。
- 固定 CPython 3.12.13 -I -B；g0_once.py 固定解释器 consumer SHA-256：A3BD1B2B1301B1EAA680ADB2A2C02A22C823E2F6EBF1FA98514616C819B2382B。
- launch_g0_once.ps1 SHA-256：DEF733516FDECFAA45CB071167466A490E62EC52956A3C342035F3560A984F3C；LAUNCH-PACKET.json SHA-256：DC2F754478B68F64D6F5BEDA95C4B68CB7713ADEF23CE713815BC95A7CD37981。
- 空隔离 profile 的准备证据 PROFILE-PREPARED.json SHA-256：B1ECF76BD31E9BB72646EB6965709C10852A9F9932CB86C242DF626ADEE89D65；隐藏、清洁 8 变量解释器哈希探测 HASH-PROBE-STATIC.json SHA-256：B0410E622C3D09E87541EE01CD57EF038DD2A925A792A4A70E32AE3A8121E62D。

## 单次运行边界与回读

launch_g0_once.ps1 只在 G0 grant 精确绑定 packet、runner、launcher 和 launch packet 且 launch-01 不存在时启动。runner 再核 grant、固定解释器、153/157 逐件输入，导入 B31 repository、provider repository 与 schema31 模块，记录实际 __file__ 和 SHA，复核输入并写 run-01/RECEIPT.json。预期状态仅为 PASS_B31_G0_CONSUMER_IDENTITY_IMPORT_ONLY。launcher 将 PID 的退出后观察写为 PROCESS-OBSERVED.json，并保存原始 stdio、退出码、profile 计数。

G0 不建库、不执行迁移、不访问 Vault/provider；任一 RED 保留原始失败并停止，不复用目录或自动重试。G0 PASS 须先由 MGR01/MGR02 审核实际回执，G1 grant 才能引用回执 SHA。G2 13 步故障回滚另门。

## 静态验证

固定解释器 AST 可解析，PowerShell parser 0 错；153 件产品和 157 件依赖逐件哈希一致；profile 4 目录、0 文件；grant/run/launch 均不存在。此证据只支持静态就绪，不构成 G0 运行 PASS。
