# Phase 0 Fake 媒体包验收

状态：PASS（本地 primitive）；K01 未完成

## 已证明

- 锁定 FFmpeg 真实生成 3 个 PNG、3 个 WAV、3 个 WebM 和 1 个 canonical manifest。
- 每个 WebM 经锁定 ffprobe 验证为 320×568、25/1 CFR、125 帧、48 kHz 单声道音轨。
- 每个 WAV 为 48 kHz mono PCM、240000 样本；PNG 尺寸和签名经过验证。
- manifest 保存真实媒体字节哈希；同一冻结输入在两个干净工作区生成完全相同的 manifest 和媒体哈希。
- 同 identity 两线程及两个独立 spawn 进程并发只产生一个完整 final，其余调用复验并返回同一包。
- 在内部 staging lease 已删除、目录 rename 尚未执行的最窄窗口强制暂停时，迟到进程被项目级 OS 锁阻塞，不能误删活跃 staging；释放后两个进程收敛到同一 final。
- 进程在镜头生成后、发布前和 rename 后强制退出，重启均恢复为一个完整包并清理已失效 staging；rename 故障不产生可见 final。
- final 包、镜头目录或媒体文件被 junction/symlink 指向包外时拒绝；已有文件/manifest 损坏时失败关闭且不覆盖。
- 每次生成前后重新核对 FFmpeg/ffprobe 字节哈希；直接构造或非开发工具链被拒绝。
- 三个 preview 的独立文件哈希可直接构造现有 `TimelineAssetV1` 与 `TimelineMediaBinding`，并由现有导出器真实生成 1080×1920、375 帧、48 kHz 音轨的 MP4。
- 非法项目/来源/hash、非 Phase 0 请求、额外字段和非 `DEVELOPMENT_ONLY` 工具链均在发布前拒绝。

## 验证命令

```powershell
uv run pytest services/api/tests/test_fake_media_package.py -q
uv run ruff check services/api/src/aijian_api/fake_media_package.py services/api/tests/test_fake_media_package.py
uv run mypy services/api/src/aijian_api/fake_media_package.py
git diff --check
```

## 严格边界

这份证据只覆盖本地媒体包 primitive。Fake Timeline 尚未引用这些真实哈希，API/UI 尚未触发生成，Timeline Workspace 尚未播放这些文件，同一 Electron 流程也尚未导出 MP4。因此 K01 仍为进行中，首个 8 周和 48 周严格计数均不增加。
