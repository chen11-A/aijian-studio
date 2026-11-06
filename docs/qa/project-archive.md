# 工程包入口与往返核验

范围：真实作品菜单的「导出工程包」「打开工程包」，原生文件选择器后由主进程读取已保存工程。渲染进程只传工程身份和整份存档指纹，不传源文件、目标目录或模块路径。页面回归使用合成工程与 IPC 替身；没有调用会员、供应商或付费生成。

## 包含与不包含

包含当前一集的文字、人物、保留的镜头版本、所选版本和实际引用的图片/音视频（包括可核验归属的不带字幕版本）。素材按 SHA256 去重，导入后逐一重映到新作品的私有素材目录。缺源或归属无法核验时拒绝整包，不把部分素材说成完整备份。

不包含历史库、已导出的最终成片、私有数据库、账号/声音授权、运行中任务、导出审核凭证或原生成来源证明。导入得到独立的新作品与系列身份；不覆盖现有作品，不自动续跑生成。保留素材字节不代表迁移原生产证明，导出仍须按真实 QC 证据判断。

## 实际验证

- 桌面真实文件测试使用现有有效 MP4、PNG、WAV：打包→新身份恢复→通过正常作品库重新读取，核对元数据、全部保留 takes、所选版本与每份媒体 SHA。
- 拒绝损坏 ZIP、项目/媒体 SHA 不符、额外可执行条目、缺源、未授权 story 媒体和渲染进程传入路径。原流式模块负责 CRC、ZIP64、路径逃逸与解压安全；没有重写该模块。
- 覆盖取消、已存在输出、并发出现同名输出、新系列身份冲突、保存失败回滚、打包期间工程/源字节变化。只清理本次拥有的新目录，保留原作品和后来产生的文件。
- 真实 Pro 菜单测试覆盖保存 canonical 后导出、导入后从作品库打开，以及切作品后迟到导入不污染当前页。对话框测试覆盖重复操作锁与固定错误文案，不展示原始路径或错误堆栈。
- Windows/Linux/checkpoint 资源收集测试实际复制原 `archive.mjs` 并核 SHA；桌面运行时测试从 resources 形状目录加载它并执行一次往返。
- 既有 `archive.test.mjs` 五项原测试实际执行，包含约 1.125 GiB 文件的流式往返、CRC、ZIP64 和安全恢复。本机该次峰值 RSS 约 91.5 MiB；不是任意工程大小的性能承诺。

## 复跑

```sh
pnpm --filter @aijian/desktop exec vitest run src/film-project-archive.test.ts src/film-project-archive-preload.test.ts src/film-project-archive-runtime.test.ts
pnpm --filter @aijian/studio-web exec vitest run src/aivora/next/ProjectArchiveDialog.test.tsx src/aivora/pro/ProWorkspace.project-archive.test.tsx
uv run pytest services/api/tests/test_project_archive_resource_collection.py
node --test packages/aivora-media/archive.test.mjs
pnpm --filter @aijian/desktop typecheck
pnpm --filter @aijian/studio-web typecheck
```

当前未验：真实 Electron 原生选择器交互、Windows 安装包实机、跨账户登录、完整 UI 几何与平台文件系统故障。文件往返与合成 IPC 测试不能替代这些验收。工程包上限为 8 GiB 素材、9000 份去重素材；不支持的外链/媒体不会自动下载或转换。
