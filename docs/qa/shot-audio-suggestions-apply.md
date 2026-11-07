# 当前单镜配声建议：明确选用执行

本切片在原只读建议之上提供整 lane 明确选用的 native 执行能力。没有自动选用、没有新供应商或付费调用，也没有本批 UI；后续界面须按下列写入与未知结果合同接入。范围仅当前单镜实际所选版，整场连续环境另行实现。

## ABI

`applyBundledFilmShotAudio`（频道 `film:audio-library-shot-apply`）只接受一个 exact 对象：`projectId / expectedProjectHash / shotId / takeId / catalogSha256 / pickerSha256 / planFingerprint / lanes`。lanes 为非空且唯一的 `ambience | sfx | score` 子集。renderer 不能传源路径、任意片段、包络或滤镜。sandbox preload 仍只执行 electron IPC，main 仍要求真实主窗口主帧。

main 在同 factory 的 active 生命周期内重新编译完整可信建议，比较已审语义指纹和库/picker pin，再取所选 lane 的全部 segments。正常保存仅改变 raw hash 时，可用 fresh raw CAS 接续同语义审核；创作、混音设置、实际 native/visual 角色 SHA/时钟或资源身份变化拒绝。fingerprint 不授信路径，也不替代 fresh 完整 rawHash。用户审核期间不持有 native active 或 renderer lease。

成功返回 `ADDED {project, receipt}`，project 是唯一 CAS 后实际 canonical readback。receipt 为：

```ts
{
  schemaVersion: 1;
  groupId: string;
  planFingerprint: string;
  memberCount: number;
  memberSetSha256: string;
  members: {
    key: string;
    clipId: string;
    creativeSha256: string;
  }
  [];
}
```

每个 clip 保留同字段的 `suggestionGroup` 创作元数据（去掉 members，加本 clip 的 key）。没有路径、令牌或 proof，不能当授权。每条仍保留实际素材名、原来源/作者/许可、asset SHA、原 gain/envelope/loop、选版绑定。原片段/旧版本/媒体不删除。

纯 helper 从 `@aijian/contracts/film-audio-suggestion-group` 导出，实际 JS/.d.ts 可由 CJS builder 收录：

- `normalizeAudioSuggestionGroup(unknown)`：闭合字段与有界数量/字符串检查。
- `audioSuggestionMemberInput(clip)`：固定顺序 JSON，覆盖 clip ID、shot/take、lane、label、placement、gain、loop、enabled、asset ID/SHA、规范 envelope；排除可携带路径、project ID 与波形缓存。
- `audioSuggestionMemberSetInput(members)`：闭合 receipt 行、唯一 key/clipId、固定 key 排序后的 JSON。
- `audioSuggestionGroupInputs(clips, groupId)`：只给待验证输入；缺成员、重复 key/ID、组声明不一致或成员 ID 在全 clips 其他记录重复均返回 null。返回 `{group,members:[{key,clipId,creativeInput}]}`。

两端对 helper 返回字符串按 UTF-8 SHA256：先 creativeInput 得 creativeSha256，再 memberSetInput 得 memberSetSha256，并比较持久组声明。仅 metadata 或 count 相同不能证明完整。成员 gain/envelope/绑定被改、缺员、重复时不得当完整组移除。当前真 ZIP 导入只重命名 project/series，不改变 shot/take/clip IDs；路径不进入摘要，因此无需凭空重签导入组。

## 信任、复制与保存

每个 clip 仍独立走原 root/owner/selected/SHA 校验。通过后，以 canonical 文件路径 + SHA 做本次 resolve 的 probe/sourceKey 复用，不缓存或跳过 SHA 授权。每个 track.key 独立，原声只保留原计划一份；WebAudio 原按 sourceKey/SHA 的有界缓存自然只解码一次。原 8 项缓存、96MiB 总量、16MiB 源读取等上限均未扩大。

每个可信 asset ID+SHA 只 wx 复制一次到当前 episode/media 下本次私有目录，多个 segments 引用同一份。用原 `transactFilmProject` 队列作唯一 CAS，队列内重新验证完整建议、资源 pin、canonical 工程、实际源和新片段真实 source window。实际 combined 计划仍受 128 tracks 和原保守完整 Windows argv 长度限制，不截断。沿用 shared plan/envelope/duck，不新建混音器或重复响度补偿。合法旧 story 配音沿 preview/QC 同一个 `storyFilmAudioOwner` 校验；未扩大 roots。

写前失败仅清本次未引用私有目录。实际 write ACK 后读回 stale/empty/wrong-project 或 write 可能已落盘但回执失败，返回 `WRITE_UNCONFIRMED / unchanged:false` 并保留可能引用的 copies；不能假称未改，也不自动重发。inspect 的非 BUSY 只能证明同 factory 前一次操作已 settled，不能单独证明成功。队列仍 pending 时即使文件已落盘，也必须继续 BUSY。

后续 UI 须继续采用原 external-write lease/unknown 保稿：fresh raw + 已审语义指纹，unknown 用原 raw delta 与完整 multiset（含重复段、包络及全局 ID 唯一）核对，而不能凭组 metadata 直接认成功或再次 apply。整组移除只删精确匹配的当前创作引用，不删文件；本切片没有 native 删除接口。

## 实际验证

- 初轮联合 8 文件 97 项通过，77.05 秒：原 manual add/target/readonly、IPC/preload、真实 mix media/QC 和新 source reuse。日志 `/tmp/shot-audio-apply-native-joint.log`。
- 最后 review 后 library 整文件 31 项通过，54.48 秒，日志 `/tmp/shot-audio-apply-library-accepted.log`；与前述 97 有重叠，不累加。含四个明确手机时点让真实 picker 轮换后复用同 asset，逐段 envelope 完整、去重 copies、实际 normalize/真 ZIP/共享计划/FFmpeg 音轨，源 bytes 保留、fresh save 后审核继续；late project/take/native/clean/library/picker/synonyms 拒绝、完整组与跨组 ID 碰撞、128+新增拒绝、写前/写后/空/旧/错工程读回和真实队列 pending 屏障。
- web 5 文件 37 项通过，20.94 秒，含原手动库宿主（unknown/quit）、mix/normalize/persistence；另 external-write lease 7 项与 main quit 10 项通过。预览同源多 track 只读/解码一次，保持 mono、seek/rate/solo、原变更与容量拒绝测试。日志 `/tmp/shot-audio-apply-web-joint.log`、`/tmp/shot-audio-apply-external-lease-tests.log`、`/tmp/shot-audio-apply-quit-tests.log`。
- 实际 isolated desktop dist + compiled contracts CJS + staged 206 库 + pinned FFmpeg，成功 apply，一次 write、完整组摘要、源 bytes 保留，没有 TS/source-loader fallback。日志 `/tmp/shot-audio-apply-isolated-runtime-accepted.log`。
- 正式双端类型、完整 workspace build、最后受影响 desktop build、CJS runtime builder、目标 ESLint/Prettier/diff 与提交后原 contracts check 均通过；没有调整 CI/coverage/timeout/工具许可。

未验证用户真实会员调用、完整 Windows Electron 窗口或本批明确选用 UI；没有将本 native 纵切标作整场自动配声已完成。
