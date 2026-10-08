# 测试与验收组经理交接

日期：2026-09-17  |  经理：测试与验收组经理（Luna/medium）  |  总控：01a08ad3-749f-76a1-a676-c689b175bf74

## 成员与职责

- 独立质量与功能验收工程师：01a0ad2d-3ca0-7680-88c2-2c2ca70e263f（a16b）。负责测试用例/测试代码、typecheck/build/test、原生验收和失败证据；不修改产品代码。
- 经理负责测试范围、证据复核、缺陷真实性/严重性分类、复测结论，并向总控交签署摘要。产品正确性、创作评审、发布验收仍由对应负责人承担。

## 在手交付包

- BASELINE-01：WIP 源码保全上传审查（非 release）。对象为 `C:\Users\Administrator\Documents\sp-archive\20260917-reorganization\candidate\manifest.json`，基线 commit `0269f7dcf753af4de4cea3f5d01b8d33c76de516`，tree `ef3db01f88e43faa86583781c57f18a114837fd1`。
- 审查范围：精确 staged 交集、允许路径、敏感内容/机器路径风险、同源 SHA-256；本轮不跑测试、构建、部署或原生验收。

## 经理签署结论

结论：允许按候选 manifest/index 原样进行 WIP 上传，未发现阻断项；该结论不等于 release、测试通过、产品正确性或 native acceptance。

证据：候选 index 与 manifest 完全一致，共 69 路径（45 modified、24 added，含 `.gitignore`）；68 个 sourceFiles 与产品 P `C:\Users\Administrator\Documents\sp\.cache\aivora-worktrees\only-ui-product-20260910` 的 manifest SHA-256 全部匹配（68/68）。commit 的真实 Git tree 已核验为 `ef3db01f…`。强秘密/常见 token/私钥/绝对机器路径模式扫描无命中；`scripts/e2e/desktop-provider-smoke.mjs` 仅为桥接键源码变更，已单独归类为可审查源码。

## 缺口与边界

- WIP 上传必须严格使用这 69 个路径；不得追加 `.aijian-dev/`、`.agents/`、`.specify/`、`specs/003-c3-native-normal/`、`services/api/0`、`services/api/1`、日志/数据库/凭据/私有素材/构建产物或机器证据。
- 本签署未验证行为正确性；C3 native 历史失败与 Issue #3 仍保留，不能因本次 hash/范围通过而接受产品。
- 若收到 Issue #3，MGR-003-01 必须重新列出：复现步骤、指定 SHA、预期/实际、原始证据、影响范围、严重性、是否阻断及交软件经理的唯一修复责任人；测试组不自行改代码。

## 下一步（暂停等待）

版本负责人可据此执行严格范围的 WIP 上传并回传远端证据；测试组随后等待总控/软件经理给定具体 SHA 和验收范围，再独立准备或运行测试。旧调度不恢复，不创建目标或自动巡检，不扩大历史审计。
