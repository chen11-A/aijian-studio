# QA03 DEV07 打包资源根候选：外置门 v2

状态：`EXTERNAL_TYPEROOTS_SELFCHECK_PASS / NOT_APPROVED / RESOURCE_02_NOT_RUN`。v1 唯一批准的 `resource-01/RECEIPT.json` SHA256 `06AB4C0341277ED74B9A0230A61139F81F75FBD3E616973EC0BF89610CFA6813`，在 typecheck 首 RED 停止。原始诊断 SHA256 `22D754E33E5E414D820E237C9E477C81EC8DB495C45AB51F7665351A89A3C783` 为 `TS2688: Cannot find type definition file for 'node'`；未 emit，也未运行 VM 负例。c19 的 `apps/desktop/node_modules/@types/node/index.d.ts` 存在，问题是外置 CompilerHost 的解析目录没有固定到 desktop 项目。v1 批准和原始输出保留，不复用。

v2 仅修外置类型解析：CompilerHost 的工作目录固定到 c19 `apps/desktop`，TypeScript 的 `typeRoots` 指向其 `node_modules/@types`，并固定 `@types/node/index.d.ts` SHA256 `E50A7130339A951E6DA9E968ED5521B0997A5B0479E148914087213839B5474C`。runner 仍以 MGR04 快照 `20260928-c19-packaged-resource-root-main-1/main.ts` SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0` 为唯一内存 overlay 候选，c19 main 保持基线 `443624A7007C6664DC232895464AA7DD41F4B38D14FB3315088B1AF9F702401E`，发射文件仅在外置 `resource-02/build`。

无产品副作用的 `selfcheck-01/SELFTEST.json` 使用与 runner 相同的 `overlay-compiler.mjs`：外置 fixture 基线带类型错误，内存候选导入 `node:path` 并使用 `@types/node`，typecheck 诊断为 0；只向外置 build 发射 JS，原基线 SHA 不变。该自检没有编译 DEV07 候选。v2 VM 负例除确认拒绝外，要求每案的错误消息与预期资源缺失原因精确匹配，并保存错误类别与消息；避免把其他异常误计为通过。

新 `RUN-APPROVAL.template.json` 状态 `NOT_APPROVED`，runId `qa03-resource-root-02`，输出目录尚不存在。另签 packet/runner/helper/快照/TypeScript/@types、c19 HEAD/status/main 后，只运行一次。首 RED 停，不自动重试或写 c19 产品树。通过只证明外置 desktop TypeScript type/emit 与抽取函数 VM 本地缺资源负例，不代表安装包、Electron 原生、打包 sidecar 或最终验收。
