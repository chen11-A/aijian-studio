# Parser 独立运行时的 contracts 闭包

冻结 `4b77b67` 的完整 renderer 门得到 5050 通过/1 失败，唯一失败是原 `film/prompt-parsers.test.ts` 调用 `check-app-parsers.mjs`。临时目录中的 `film/audio.mjs` 引入新增的 group 规范模块，但脚本旧 resolver 只物化相对 `.ts`，保留了裸 `@aijian/contracts/film-audio-suggestion-group`。临时目录无该包，Node 因 `ERR_MODULE_NOT_FOUND` 退出。证据：`/tmp/aivora-shot-apply-root-full-renderer.log` 第 138–166 行。

仅修 checker 的依赖物化：读取真实 contracts package 的明确 public export.default，限制于 canonical contracts/src 内的 `.js/.ts` 运行模块，拒绝声明文件、绝对导入或边界逃逸。继续递归物化其相对 JS 闭包，把 group→mix-plan 和 app 引用都重写成原临时目录内的相对 `.mjs`。没有任意包 resolver、NODE_PATH、全局包、TS loader 或直接 require 源码兜底。

原八种 parser、所有示例、字段/合并内容与原文覆盖判定、原 `prompt-parsers.test.ts` 保持不变。编译仍由原 TypeScript transpileModule 完成，临时目录 finally 清理；源目录不写产物。

实际验证：

- 原 `node packages/aivora-prompts/scripts/check-app-parsers.mjs` exit 0，全部读对，保留原导演镜数/覆盖提醒。日志 `/tmp/parser-runtime-checker.log`。
- 原 `film/prompt-parsers.test.ts` 1 项通过，1.58 秒，日志 `/tmp/parser-runtime-original-test.log`。
- 独立无 node_modules 的临时目录，真实物化 audio/group/mix-plan `.mjs`，检查三模块没有裸 contracts 导入，并实际加载 normalize 与 group helper，保留创作组字段。exit 0，日志 `/tmp/parser-runtime-isolated-closure.log`。这是依赖闭包与 normalize 证据，不是媒体授权或真实组 receipt 成功证明。
- 目标 ESLint、`node --check`、Prettier/diff 检查通过。

没有产品、依赖、锁、测试阈值或供应商调用变更。完整 renderer/覆盖率门由总控合入后复验，不将单项通过替代完整门。
