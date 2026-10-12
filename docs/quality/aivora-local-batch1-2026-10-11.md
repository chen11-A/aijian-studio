# 第一批本地检查点：DRAFT 审片与人工修改入口

基线 `32d014624aad134a6884121a58a26b75088104c9`，候选分支
`codex/aivora-product-local-20261011`。启动时原 `work` 在 `63c76db…` 且干净；
只读远端核对参考分支仍在指定基线，从指定提交建立本地分支，没有改远端。
仓库及工作区未发现 AGENTS.md/.agents/skills。遵循用户的完整产品范围，
保留原 README/DOTS 历史、安全审计、CI 和质量门槛；没有采纳新的归档排除。

## 代码与行为

- MediaPages 的真实 review/changes/export 路由进入 NativeDraftPages。
- 共用 DraftReviewWorkspace，复用 export GET/list、notes/revision gateways 和
  原 SQLite 对象；选择游标只扩展既有 workspace-selection 元数据。
- 同 scope 精确操作恢复，无首项/最新项回退；历史原版不受最近 20 条列表限制。
  64 分集游标上限只限制 UI 位置记录，不删业务历史或输入。
- 复用原 DraftExportOutput/Notes/RevisionPlans。原 export history 默认行为保留；
  产品 export 的评论仅在选中工作区显示，避免重复编辑器。
- 明确批准后的导航保持同分集；用户另行修改并保存装配、另行导出，随后关联
  批准后不同装配的候选。无 Provider、编码、发布或计费自动执行。
- 未提交输入离开/切版本有确认，缓存失败提示可能丢失。已有 pending/input
  journals 继续恢复原标识和内容；UNKNOWN 不自动重发。
- 抽出纯展示与类型辅助，使原超长组件净减少；新工作区组件/钩子均低于200行。

## 已执行验证

2026-10-11，云 Linux，Node 24.19.0 / pnpm 11.19.0 / Python 3.12.14。
测试依赖按 pnpm/uv 锁文件准备，pnpm 禁用安装脚本；无版本/锁文件修改。
这里的依赖准备不是产品安装器或安装验收。

| 检查                 | 结果和实际范围                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 18个渲染器定向文件   | 185通过；含原 media pages、draft export/output、notes/plans、input/recovery、scope/navigation、新闭环、native route 和 transport                 |
| 4个桌面定向文件      | 177通过；draft-review、draft-review-revision、draft-export、draft-export-output；契约/客户端/IPC，未启动实际窗口                                 |
| 5个Python定向文件    | 88通过；review notes/revision、schema/helpers stdlib、verification boundaries；真实临时合成媒体/数据库和原受控 Linux FFmpeg 路径，无真实服务调用 |
| TS类型检查           | contracts、desktop、studio-web均通过；no-emit，没有产品构建                                                                                      |
| Python严格类型检查   | mypy通过238源码模块                                                                                                                              |
| pnpm lint            | ESLint、Ruff、全仓原配置Prettier及428个Python文件格式检查通过                                                                                    |
| pnpm contracts:check | OpenAPI/生成TS无差异                                                                                                                             |
| git diff --check     | 通过                                                                                                                                             |

最终同功能输出类型/identity辅助提取后，单独重跑 output 测试及受影响类型/lint；
桌面/Python未变，复用本批已通过证据，不重跑无关全量测试。
日志保存在本地 `docs/quality/evidence/aivora-batch1-20261011/`。
这些定向测试未重新计算整仓覆盖率门禁，不代表整仓全量测试/CI/发行通过。

必要边界已覆盖：双作品双分集独立输入；A→B→A和过期读回；未提交输入；
UNKNOWN恢复和只读核对；列表/GET hash、旧装配、大小不符；文件失效后的
历史记录；批准拒绝、批准前/同装配候选拒绝；候选差异和独立人工复核。

## 仍未验证/未完成

HTML播放器定位近似，整数帧只是精确批注坐标。没有正式签发、自动最小重做、
完整输出或实时未保存装配播放。DRAFT 32视觉/32音频/30分钟/1920限制不变。
没有Windows原生窗口、真实播放/帧定位、模型/音画/口型/创作质量、安装升级恢复
验收，没有真实调用、凭据录入或费用。原Word未逐页核对，不能称历史需求穷尽。
其他产品缺口及依赖见需求实现测试矩阵；原安全和CI问题未因本批局部通过清零。
