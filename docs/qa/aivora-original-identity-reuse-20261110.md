# 原件复用修复（与 API55 隔离）

代码来自 `dd55bbc4402489ab73654491a3e32f820d606f00`，本分支提交是其原样拣选。不批准集成。完整性问题没有关闭。Windows 正常重复读取被拒绝，不能写成 Windows 功能已修。

支持范围只包括带 `inotify_init1` 的 Linux。Windows 没有已验证观察器，`arm()` 返回空，同一次 `availability_read_scope` 里的下一次调用返回 `UNKNOWN_MEDIA_CHANGED`，不第二次哈希，也不信任 stat。

无观察器分支跑原有定向（强制 `arm()` 返回空）：`6 failed, 5 passed in 1.97s`。

失败：

- `test_stable_original_allows_distinct_named_and_held_ctime_without_rehash`：未改文件的第二次调用变成 `UNKNOWN_MEDIA_CHANGED`，期望 `VERIFIED`
- `test_cached_original_does_not_trust_metadata_when_reopening_fails`：第二次变成 `UNKNOWN_MEDIA_CHANGED`，期望 `UNKNOWN_MEDIA_READ`
- `test_recursive_duplicate_originals_hash_once_and_independent_request_resets`：来源检查 `BLOCKED`，期望 `CURRENT`
- `test_recursive_candidate_and_g5_originals_share_direct_read_allowance` 的 manual 真/假两档：第一次正常 inspect 的来源检查就是 `BLOCKED`
- `test_original_scope_does_not_cache_changed_identity_and_always_resets`：同 scope 嵌套再读期望 `VERIFIED`，得到 `UNKNOWN_MEDIA_CHANGED`

仍通过：同 stat 覆写测试、元数据变化拒绝、哈希期间元数据变化后的额度不退款。覆写测试通过是因为第二次一律拒绝，不是因为 Windows 能观察写入。

会阻断的 Windows 主链：`EpisodeAssemblyReadinessService.inspect` 在一个 scope 里先由 `_collect_checks` 哈希，再由 `exact_local_original` 复读同一原件。第二次不是 `VERIFIED` 时，G5 路径映射 `G5_AUTHORITY_CHANGED`，未钉视觉的故事板路径映射 `STORYBOARD_REFERENCE_STALE`，手工候选路径映射 `MANUAL_CANDIDATE_SOURCE_INVALID`。来源检查因此不能保持 `CURRENT`。

不阻断：

- `NOT_NEEDED` / `LOCAL_SELECTED_MEDIA` 在 desktop 本地核所选媒体，不进入这个 Python scope。
- 装配 `original_for_hash` 和本地审阅 `original()` 不打开 `availability_read_scope`，每次核验都重新哈希。
- `video_recovery` 使用自己的读取，不走这份缓存。
- 本地审阅 `target` / `write` / `status` 在同一次 scope 里只调用一次 `_availability`，第一次哈希仍可返回 `VERIFIED`。

没有重跑全套，没有改 desktop 文件，没有继续试别的观察器。
