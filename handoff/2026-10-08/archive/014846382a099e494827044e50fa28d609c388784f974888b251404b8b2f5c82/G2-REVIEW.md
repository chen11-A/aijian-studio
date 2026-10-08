# G2 managed path / selected ASV 静态复审包

状态：**仅静态准备，未运行 G2**。`GRANT.json`、`run-01`、`launch-01` 均不存在。请 MGR01 先复审范围与运行器，再由 MGR02 针对固定字节签发一次性授权；任何意外 RED 保留证据并停止，不重试。

| 当前文件 | SHA256 |
| --- | --- |
| `PACKET.json` | `1B159F3E5F8E88DA3638423BCBA5BCCF45D60E0B8556CDB512EE8CDDDBD30751` |
| `g2_once.py`，固定 Python 消费者视图 | `F02E53D8BB4BB95457204DB6B9A951163185A6A534D62E06478E0CDF90CDFF33` |
| `launch_g2_once.ps1` | `319784D8B76E3F97195119FF1A53D0540E184DD96192F78521365324472C0C5C` |
| `LAUNCH-PACKET.json` | `27D2232B8711B0D33AC60E969B0840136F49B6F42889C34AE4473E4F278AE190` |
| `INPUT-PREPARED.json` | `87FA654EC57B4671D4470C8C376A7165E1AA6839A6C228E36A5EA5B96BC77FDE` |
| `STATIC-REVIEW.json` | `C6BCC75571B020697381B1B85F7125D222387E7790FA125ACDB95306C17175F5` |

## 样本和确定性预期

样本是 66 字节 JPEG **头部特征**文件，SHA `12FE6294AE88327A30ED730A5CE208C72CEDF1692E8B279670C23283167B0426`；仅用于本地导入、ASV 元数据与逐字节哈希，不主张图像可解码或媒体探针通过。计划在新 QA workspace 建 schema30 DB 和合成项目，经 `MediaAssetStore.import_local` 产生 ASV，再由 selected reader 复核。DB 路径 197 字符，content-addressed blob 266 字符；源文件路径 181 字符。读前显式检查/清理 QA DB WAL，逐案比较读取前后文件目录和 SHA。

| 用例 | 单次运行要求的结果 | 复现方式 |
| --- | --- | --- |
| 长受管 blob 和对应 ASV | `VERIFIED` | 本地 synthetic import，固定字节/ASV/DB 回读 |
| ASV 缺席 | `NOT_FOUND` | 格式合法但不存在的 asv ID |
| blob 缺席 | `MISSING` | 单独复制 QA DB，不复制 media-assets |
| blob 同大小改字节 | `CORRUPT` | 单独 QA DB/blob 副本 |
| DB 缺席 | `UNKNOWN_DATABASE` | 现存普通目录下不存在的 DB，确认未创建 |
| 合成非空 WAL | `UNKNOWN_DATABASE_BUSY` | 单独 QA DB 的非空 WAL 哨兵；**非真实并发写者** |
| reparse workspace | `UNKNOWN_UNSAFE_PATH` | QA 内预备符号链接，确认读取不写目标 |
| 路径拒绝 | `ValueError` | 相对、`..`、UNC、ADS、reparse；不访问外部目标 |

`UNKNOWN_MEDIA_CHANGED` 的真实读取竞态、真实写者下的 busy DB 和映射网络盘均列为**独立待验门**。单次确定性 G2 不依赖时序命中，也不把合成 WAL 称作真实并发证明。

## 旧证复用与本轮增量

先前 import 回执仅证明固定 core153/157 导入身份；G1 回执/退出记录仅证明当前组合的 v26→v30 迁移与复开；旧 repo30 RESULT/closure 仅证明版本绑定的 schema/fault 历史。以上均不替代本轮 managed path、ASV 或 selected read 的行为结果。本轮计划只写 `run-01` 的 QA DB/WAL/SHM、受管 staging/blob、负例副本及证据，和 `launch-01` 进程证据；不写产品、c19，不调用 provider。

审计路径规范化只接受本地盘符绝对路径和对应 `\\?\C:\...` 写法。`PATH-AUDIT-STATIC-02.json` SHA `F95A94BC9FA70D5812D5084E818741CAB492452DA7F12C248F3A7BD98049A1F8` 纯数据验证 266 字符本地路径可写，普通/扩展 UNC、设备、GLOBALROOT、相对、外域拒绝；`LONG-INVENTORY-STATIC.json` SHA `90197DA4C35CEF2E141BEF0D7C8D60699E7CEFC7D695C6001BC6B557949DB90C` 验证 QA 长路径可作读前后清单。第一稿 runner/packet/launcher/launch packet 已分别保留为 `*_draft01`，原始 SHA 见 `PACKET.json`。

独立静态回读确认 Python AST、PowerShell 解析错误 0、产品 153/153、依赖 157/157、历史 closure 24/24、G1 固定回执、样本与符号链接状态。净化哈希探针 `HASH-PROBE-STATIC.json` SHA `AF29BED1B914FC93059D612BF5F2E9219A45809D74C5B068D9841B6B1E179508`：隐藏进程、8 项隔离环境、退出 0、stderr 空、runner 消费者哈希匹配。profile-01 为 4 个目录、0 文件、0 链接。