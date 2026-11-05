# 4A 导出比例选择协调交接

## 已提供

`pro/actions/export-selection.ts` 提供：

- `exportAspectPlan(film, choice)`：纯函数；choice 为 `work | other | both`。以作品比例为基准，旧作品缺比例时沿用竖屏；双比例先导作品比例，再导另一比例。
- `exportFilmSelection(base, paths, directory, host, choice)`：复用现有 exportFilmTask，不生成媒体。首个任务同步入队；未指定目录时只选择一次，第二份复用实际目录。
- host 为 `{ current, valid, apply, signal? }`。valid 是宿主保存权限/请求序号检查，current 返回当前作品；**apply 同步返回 void**。协调器不等待磁盘持久化，宿主仍负责保存协调及失败处理。
- 返回 `{ status, outputs, primaryPath, directory, error? }`。status 为 `done | partial | failed | cancelled | stale`；outputs 为实际成功交给宿主的 `{aspectRatio,path}[]`。两份都成功才是 done；第二份失败为 partial。
- primaryPath 和作品 exportPath 保留第一份成功文件，供打开/播放；第二份路径在 outputs。写回以当前作品为基础，保留期间其他字段编辑。
- 错误 code 为 `EXPORT_FAILED | EXPORT_CANCELLED | WORK_STALE`；detail 为异常信息。界面使用文案映射，不直接展示内部代码。

宿主应把 Claude 的 exportAspects 传给协调器，而不是直接循环旧导出函数。本次没有改 ProWorkspace、JSX、CSS，也不替代宿主互斥/保存逻辑。

## 取消与文件边界

exportFilmTask 接受可选 signal；runTask 传播取消、及时结束任务，禁止晚到响应改为成功。signal 不序列化进桌面 IPC。

主动取消调用现有 cancelFilmExport(requestId)。项目或保存权限变更由最多 100ms 间隔检查捕获，取消当前导出，禁止启动下一份或写入另一个作品。第一份成功后取消第二份，返回 cancelled 并保留第一份。

现有 assembleFilm 没有取消 IPC。组装期间取消会立即结束协调器、禁止后续导出/写回，但无法停止已开始的底层组装，其晚到结果被丢弃；没有声称物理停止组装。

真实桌面实现 apps/desktop/src/film-export.ts 自动追加 `-16x9.mp4` / `-9x16.mp4` 后缀。协调器另检查重复返回路径，不把一个文件冒充两个成功输出。

## Claude PipelineSteps 待接线风险

只读核对 ed0409a641156f33a6a8894e9b47feebb33ffffa 的 next/PipelineSteps.tsx：problems 列表排除了所有 `target.id === "all"`。GPT 的 assembly 和 review 合法使用 all 目标，因此 assembly/all 失败、阻塞或结果不明时可能没有原因与重试入口。

应由 Claude 调整筛选，只排除已由专门人工审片区展示的相应 review 状态，不能全局排除 all。继续使用 pipelineView.retryable 和 pipelineRetryKey，不另造编号。整合仍需完成 PipelineSteps 与 pipelineWorkspace 的真实宿主接线；本次未修改组件。

## 验证

相关 web 测试 31 通过、0 失败，覆盖比例、单次选目录、首份保留、部分失败、重复路径、即时取消、晚到结果、切换作品、失效权限、组装取消及保留当前编辑。桌面 film-export 测试 14 通过、0 失败，包含真实本地 ffmpeg 双比例输出检查。web tsc、相关 eslint、prettier 和 git diff --check 通过。

以上为自动化及本地 ffmpeg 验证，不是 Grok 会员或 Windows 安装后的用户实测。
