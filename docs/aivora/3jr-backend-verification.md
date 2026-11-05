# 3JR 后端验证记录

固定代码：`c3cd585b6932893bca95640ca94de3f30ab57cd9`（2026-11-05 UTC）。其后的 `70c4cfa` 只补文档。逐项状态与代码提交见[任务书](给GPT的任务书.md)的“3JR 实测问题修复记录”。没有真实会员调用、没有合并界面、没有阶段发版。

| 检查                     | 结果                                        | 证据                             |
| ------------------------ | ------------------------------------------- | -------------------------------- |
| web全量                  | 4217通过、1失败、0跳过；324个文件，353.19秒 | `/workspace/jr-web-final.log`    |
| 全仓TypeScript           | contracts、desktop、studio-web均通过        | `/workspace/jr-final-types.log`  |
| 全仓ESLint               | 通过                                        | `/workspace/jr-final-eslint.log` |
| 全仓Prettier、Python格式 | 通过；558个Python文件格式正确               | `/workspace/jr-final-format.log` |
| Python相关回归           | 32通过、0失败、0跳过，61.36秒               | `/workspace/jr-python-final.log` |
| ruff                     | 通过                                        | `/workspace/jr-ruff-all.log`     |
| mypy                     | 310源文件通过                               | `/workspace/jr-mypy-all.log`     |

web唯一失败为 `next/wiring/noticeCopy.test.ts > has a line for every code GPT can send`：当前分支缺102个映射，其中101条已在Claude的48a5825交付但未合并；另1条是本轮新增的 `LOCATION_SOURCE_REQUIRED`。没有跳过或弱化这个检查。此次使用 `vitest run --coverage`，失败后没有生成覆盖率报告，故不报告本轮覆盖率或宣称门槛通过。

本轮没有重跑desktop或Python全量。此前desktop 2001通过、Python 5138通过/6跳过属于旧固定提交，只保留历史证据；Python本轮更改了导出返回字段和导演提示词，不能把旧全量当成当前全量。32项包括 `test_story_film.py`、`test_film_agents.py`、`test_director_source_grounding.py`。有真实本地ffmpeg生成/校验，但供应商回复由测试替身提供。

首轮web日志 `/workspace/jr-web-full.log` 为收尾变更期间的运行：4213通过、4失败，保留为诊断记录；最终固定重跑不拼接该结果。Python首次命令因默认uv缓存目录只读未开始测试，随后使用可写的 `UV_CACHE_DIR=/workspace/.cache/uv` 正常执行；没有绕过权限限制。

尚需实际材料：这次实测的project.json及导演/动作原回复，以核实19/21镜、19个动作与错误尾段；已登录会员环境以验人物、场景画面和单场四分钟成功率。现有小说已核实，不臆造缺失的角色年龄或原文没有的停车事件。镜头上限与内容完整性冲突时仍保留内容并报告风险，未硬截断。

后续增量另附相关验证，不冒充包含在本次固定提交全量中：B08的场景前置失败队列终态补修与4A-B10导出协调仍在继续。
