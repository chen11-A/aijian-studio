# Native assembly preview admission

The assembly page explicitly reads an execution plan for its exact saved project,
episode and assembly version. The authenticated sidecar derives it using the
existing assembly store, persisted probe evidence and execution-plan builder.
This GET never probes, encodes, generates, launches a process or writes a task.
Fresh storyboard/G5 admission and current source availability and rights apply.
The version and plan hashes remain separate immutable identities.

The desktop client correlates the HTTP request ID and validates the closed plan
shape and canonical SHA-256. The renderer independently checks the hash, source
identity, timebase, canvas and every saved segment. Unknown reads retain labelled
earlier evidence while closing controls. Unsubmitted input or an unreliable
assembly closes admission; returning to a saved version requires a new explicit
read. Keyed scope lifetimes prevent project/episode/version A→B→A replies from
being accepted.

The existing six media-preview session channels are now registered in main and
exposed by the sandboxed preload without runtime relative imports. Main requires
the live top frame and rechecks its navigation epoch after asynchronous work.
Renderer bridge presence indicates an API, never installation or playback.
The current host returns NATIVE_HOST_NOT_INSTALLED honestly. No executable,
binary hashes, installer permission or native clock is invented by this batch.

MLT playback stays in the existing separate native SDL2-window contract. The
renderer displays only accepted host receipts, with shown frames distinguished
from native audio-output time. It does not synthesize position from a timer.
Open intent is recorded before invoking the host; UNKNOWN cannot open again.
A status response saying only that a host is unavailable cannot clear an earlier
UNKNOWN open intent. There is no replacement canvas, WebAudio or DRAFT player.

The existing mapper currently accepts the verified same-size CFR video subset.
Images, scale, multitrack audio gain/conform and subtitle style still need explicit
versioned execution contracts. The frozen engineering TEST adapter is unchanged
and cannot be admitted through this product preview bridge. DRAFT output limits
and the original-file reader limit are retained.

Next native work must supply a trusted local launch resolver and bounded session
lifecycle, then a pinned, license-reviewed native host profile. Launch must read
and revalidate the exact plan and actual sources again. Protocol tests can use
controlled adapters; they do not establish Windows window/decoder/clock quality,
real playback, synchronization, installation or full-product acceptance.

## Main-process session supervisor

The registered host now owns bounded ephemeral open IDs, session generations and
command journals. It reads the exact plan again before passing it to a main-only
trusted runtime. Identical requests do not relaunch or redispatch; conflicting IDs,
old generations, wrong-scope/clock/lease receipts and contradictory control
outcomes cannot advance the controls. UNKNOWN controls reconcile by the original
open ID. A late plan read never launches; a late connection after timeout or
invalidation is terminated once. Navigation, window close, app exit and lease
expiry revoke control and request bounded owned termination.

The default bounds are 64 retained sessions, 256 command records per session, a
five-minute lease and a ten-second call deadline. These are control/resource
bounds, not media export limits or acceptance of a full production session. Old
request IDs are retained, including terminal entries; reaching capacity explicitly
refuses another operation. A verified runtime must enforce the hard lease in the
native child and prove owned termination, including partial launch failures. This
candidate does not supply that runtime or an approved binary/dependency/license
profile, and production passes `runtime: null`. The supervisor does not authorize
an unverified executable. Restart loses only ephemeral process ownership; a prior
renderer open marker remains UNKNOWN and cannot automatically open again.

Shown frames still come exclusively from admitted native receipts. A timer only
revokes the lease and clears clock authority. An UNVERIFIED clock is never rendered
as an observed frame. Controlled protocol tests demonstrate these boundaries,
not native Windows process-tree termination or audio hardware timing.

## 第二十一批生命周期补强

终态只描述会话状态。launchPending和releaseConfirmed分别记录仍在启动和已确认owned进程终止；同集新pvo在旧启动/清理未确认时拒绝。bounded termination超时保持占用，不能据FAILED/EXPIRED/CLOSED释放。迟到连接单次终止并追踪证据，部分启动拒绝无法证明清理时同样保留占用。没有合成native时钟，production runtime仍null。两项独立复现与修复证据见第二十一批检查点。

## 第二十二批源码目标

新增可信原生宿主与owned Job源码、明确MLT显式模块补丁、完整profile和私有有界进程协议/适配器、同一精确计划的原件快照租约。详细源合同见[MLT原生宿主源码](native-mlt-source-host.md)。这批没有C++编译/安装/运行，真实所有者绑定未接入main/sidecar，production runtime仍null；受控管道不证明MLT核心/窗口/解码/播放。下一源码批次继续私有绑定和文件/PE准入，后续具体工具获取/构建/Windows运行另获授权。

第23批补充完整被持有PE字节的依赖图准入及原生启动封存源码；pipe factory
先核对私有完整profile证明，OwnedJob取消裸路径启动并持有sealed文件。受控
合成PE/管道用例不代表Windows DLL/Job/窗口已验收；实际私有binding和二进制
profile仍待完成，production runtime:null。详见native-mlt-source-host.md和第23批检查点。
