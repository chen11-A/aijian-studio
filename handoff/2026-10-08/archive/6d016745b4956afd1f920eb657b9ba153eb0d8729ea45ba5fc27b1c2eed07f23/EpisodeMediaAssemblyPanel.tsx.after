import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./Common";
import { readAssetLibrary } from "./adapters/assetLibrary";
import type { AssetLibraryGateway, MediaAsset } from "./adapters/assetLibrary";
import {
  parseAssemblyReceipt, staticAnimaticContent,
} from "./adapters/episodeMediaAssembly";
import type {
  AssemblyMediaRef, AssemblyVersion, EpisodeMediaAssemblyGateway,
} from "./adapters/episodeMediaAssembly";

type Still = { media: AssemblyMediaRef; frames: number };
type Props = {
  projectId: string;
  episodeId: string;
  assets: AssetLibraryGateway | undefined;
  assembly: EpisodeMediaAssemblyGateway | undefined;
};

function key(media: AssemblyMediaRef): string {
  return `${media.asset_id}/${media.asset_version_id}/${media.sha256}`;
}

function readableError(kind: string, status?: number, code?: string): string {
  return kind === "DEFINITE_SERVER_ERROR"
    ? `服务端拒绝：${status} / ${code}` : "结果未知；请只读查询集级装配版本。";
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((name) =>
      `${JSON.stringify(name)}:${canonical(object[name])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function pendingKey(projectId: string, episodeId: string): string {
  return `aivora:episode-media-assembly:pending:${projectId}:${episodeId}`;
}

function pendingContent(projectId: string, episodeId: string): string | null | undefined {
  try { return window.localStorage.getItem(pendingKey(projectId, episodeId)); }
  catch { return undefined; }
}

function persistPending(projectId: string, episodeId: string, content: unknown): boolean {
  try {
    const key = pendingKey(projectId, episodeId);
    const value = canonical(content);
    window.localStorage.setItem(key, value);
    return window.localStorage.getItem(key) === value;
  } catch { return false; }
}

function clearPending(projectId: string, episodeId: string): void {
  try { window.localStorage.removeItem(pendingKey(projectId, episodeId)); }
  catch { /* A failed clear keeps later writes locked. */ }
}

/** Actual image bytes form a draft Animatic; no audio, motion, or export claim is made. */
export function EpisodeMediaAssemblyPanel({ projectId, episodeId, assets, assembly }: Props) {
  const epoch = useRef(0);
  const activeScope = useRef("");
  const scope = `${projectId}/${episodeId}`;
  activeScope.current = scope;
  const [library, setLibrary] = useState<MediaAsset[] | null>(null);
  const [headReliable, setHeadReliable] = useState(false);
  const [version, setVersion] = useState<AssemblyVersion | null>(null);
  const [stills, setStills] = useState<Still[]>([]);
  const [assetChoice, setAssetChoice] = useState("");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewReady, setPreviewReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writeUnknown, setWriteUnknown] = useState(false);
  const [notice, setNotice] = useState("");

  const editable = !version || (
    version.content.visual_segments.every((segment) => segment.media_kind === "image") &&
    version.content.audio_segments.length === 0 &&
    version.content.subtitle_segments.length === 0 &&
    version.content.sequence_timebase.frame_rate.num === 25 &&
    version.content.sequence_timebase.frame_rate.den === 1
  );
  const choices = useMemo(() => (library ?? []).flatMap((asset) =>
    asset.versions.filter((item) => item.kind === "image" &&
      item.availability === "VERIFIED" && item.rights_status !== "RESTRICTED")
      .map((item) => ({ asset, version: item, value: `${asset.id}/${item.id}` }))), [library]);
  const totalFrames = stills.reduce((sum, shot) => sum + shot.frames, 0);
  const active = stills.find((shot, index) => {
    const start = stills.slice(0, index).reduce((sum, item) => sum + item.frames, 0);
    return frame >= start && frame < start + shot.frames;
  });
  const image = active ? previews[key(active.media)] : undefined;
  const canPlay = headReliable && stills.length > 0 && previewReady &&
    (!version || version.playback_status === "DRAFT_STATIC_ANIMATIC") &&
    (!version || version.media_checks.every((check) =>
      check.availability === "VERIFIED" && check.rights_status !== "RESTRICTED"));

  async function load() {
    const request = ++epoch.current;
    const pending = pendingContent(projectId, episodeId);
    setHeadReliable(false);
    setWriteUnknown(pending !== null);
    setPlaying(false);
    setBusy(true);
    const [assetState, assemblyResult] = await Promise.all([
      readAssetLibrary(assets, projectId),
      assembly?.readLatest(projectId, episodeId).catch(() => ({ kind: "REMOTE_UNKNOWN" as const })),
    ]);
    if (request !== epoch.current || activeScope.current !== scope) return;
    setBusy(false);
    setLibrary(assetState.kind === "READY" ? assetState.assets : null);
    if (!assembly || !assemblyResult) {
      setNotice("当前版本没有集级媒体装配的读写接口。");
      return;
    }
    if (assemblyResult.kind === "NOT_FOUND") {
      setHeadReliable(true);
      setVersion(null);
      setStills([]);
      setFrame(0);
      setNotice(pending === null
        ? "尚无集级媒体装配版本；可从项目图片素材创建静帧 Animatic 草稿。"
        : "尚未读到装配版本，但先前写入结果仍未知；不得重复提交。");
      return;
    }
    if (assemblyResult.kind !== "FOUND") {
      setNotice(readableError(assemblyResult.kind,
        assemblyResult.kind === "DEFINITE_SERVER_ERROR" ? assemblyResult.status : undefined,
        assemblyResult.kind === "DEFINITE_SERVER_ERROR" ? assemblyResult.code : undefined));
      return;
    }
    const read = parseAssemblyReceipt(assemblyResult.receipt, projectId, episodeId);
    if (!read) {
      setNotice("装配读回身份或轨道结构不符；不展示为可播放版本。");
      return;
    }
    setVersion(read);
    setHeadReliable(true);
    setFrame(0);
    setStills(read.content.visual_segments.map((segment) => ({
      media: segment.media, frames: segment.end_frame - segment.start_frame,
    })));
    const reconciled = pending !== null && pending !== undefined &&
      canonical({
        content: read.content,
        parentVersionId: read.parent_version_id,
        expectedRevision: read.parent_version_id === null ? null : read.head_revision - 1,
      }) === pending;
    if (reconciled) clearPending(projectId, episodeId);
    const locked = pendingContent(projectId, episodeId) !== null;
    setWriteUnknown(locked);
    setNotice(`已读回集级装配 ${read.version_id}；${read.playback_status}，正式导出 ${read.export_status}。${locked ? "先前写入未核实，仍锁定保存。" : ""}`);
  }

  useEffect(() => {
    setLibrary(null);
    setHeadReliable(false);
    setVersion(null);
    setStills([]);
    setWriteUnknown(pendingContent(projectId, episodeId) !== null);
    setNotice("");
    void load();
    return () => { epoch.current += 1; };
  }, [projectId, episodeId, assets, assembly]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    setPreviews({});
    setPreviewReady(false);
    setPlaying(false);
    if (!assets || !library || !stills.length) return;
    void (async () => {
      const next: Record<string, string> = {};
      for (const still of stills) {
        const identity = key(still.media);
        if (next[identity]) continue;
        const asset = library.find((item) => item.id === still.media.asset_id);
        const item = asset?.versions.find((candidate) =>
          candidate.id === still.media.asset_version_id &&
          candidate.sha256 === still.media.sha256 && candidate.kind === "image" &&
          candidate.availability === "VERIFIED" && candidate.rights_status !== "RESTRICTED");
        if (!item) return;
        const read = await assets.readProjectMediaAssetPreview(
          projectId, still.media.asset_id, still.media.asset_version_id,
        ).catch(() => ({ kind: "REMOTE_UNKNOWN" as const }));
        if (cancelled) return;
        if (read.kind !== "READY" || !(read.bytes instanceof Uint8Array) ||
            read.sha256 !== item.sha256 || read.mime_type !== item.mime_type ||
            read.bytes.byteLength !== item.byte_size) return;
        const url = URL.createObjectURL(new Blob([new Uint8Array(read.bytes)],
          { type: read.mime_type }));
        urls.push(url);
        next[identity] = url;
      }
      if (!cancelled) {
        setPreviews(next);
        setPreviewReady(true);
      }
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [projectId, assets, library, stills]);

  useEffect(() => {
    if (!playing || !canPlay || totalFrames <= 0) return;
    const start = performance.now() - frame * 40;
    let handle = 0;
    const tick = (now: number) => {
      const next = Math.floor((now - start) / 40);
      if (next >= totalFrames) {
        setFrame(totalFrames - 1);
        setPlaying(false);
        return;
      }
      setFrame(next);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, canPlay, totalFrames]);

  function addStill() {
    const choice = choices.find((item) => item.value === assetChoice);
    if (!choice || !editable || busy || writeUnknown) return;
    setPlaying(false);
    setStills((old) => [...old, {
      media: { asset_id: choice.asset.id, asset_version_id: choice.version.id,
        sha256: choice.version.sha256 }, frames: 50,
    }]);
  }

  function changeStill(index: number, update: Still | null) {
    if (!editable || busy || writeUnknown) return;
    setPlaying(false);
    setFrame(0);
    setStills((old) => update === null ? old.filter((_, at) => at !== index) :
      old.map((shot, at) => at === index ? update : shot));
  }

  async function save() {
    if (!assembly || !headReliable || !editable || !stills.length || busy || writeUnknown ||
        !stills.every((shot) => Number.isSafeInteger(shot.frames) &&
          shot.frames > 0 && shot.frames <= 750) || totalFrames > 1_000_000 ||
        pendingContent(projectId, episodeId) !== null) return;
    const request = ++epoch.current;
    const content = staticAnimaticContent(projectId, episodeId, stills);
    if (version) {
      content.sequence_timebase = version.content.sequence_timebase;
      content.canvas_width = version.content.canvas_width;
      content.canvas_height = version.content.canvas_height;
      if (canonical(content) === canonical(version.content)) {
        setNotice("静帧轨道未变化；无需创建重复版本。");
        return;
      }
    }
    if (!persistPending(projectId, episodeId, {
      content, parentVersionId: version?.version_id ?? null,
      expectedRevision: version?.head_revision ?? null,
    })) {
      setWriteUnknown(true);
      setNotice("写入意图未能持久保存并回读；未提交装配版本。");
      return;
    }
    setBusy(true);
    const result = await assembly.createVersion(projectId, episodeId, {
      content, parent_version_id: version?.version_id ?? null,
      expected_revision: version?.head_revision ?? null,
      change_summary: "更新集级静帧 Animatic 镜头轨道",
    }).catch(() => ({ kind: "REMOTE_UNKNOWN" as const }));
    if (request !== epoch.current || activeScope.current !== scope) return;
    setBusy(false);
    if (result.kind !== "CREATED") {
      setHeadReliable(false);
      if (result.kind === "DEFINITE_SERVER_ERROR" && result.status < 500)
        clearPending(projectId, episodeId);
      setWriteUnknown(pendingContent(projectId, episodeId) !== null);
      setNotice(readableError(result.kind,
        result.kind === "DEFINITE_SERVER_ERROR" ? result.status : undefined,
        result.kind === "DEFINITE_SERVER_ERROR" ? result.code : undefined));
      return;
    }
    const saved = parseAssemblyReceipt(result.receipt, projectId, episodeId);
    if (!saved || canonical(saved.content) !== canonical(content)) {
      setHeadReliable(false);
      setWriteUnknown(true);
      setNotice("保存回执身份或内容不符；请只读查询，不能重复提交。");
      return;
    }
    setVersion(saved);
    setHeadReliable(false);
    setWriteUnknown(true);
    setNotice(`已收到装配 ${saved.version_id} 的保存回执；正在重新读取当前版本。`);
    void load();
  }

  return <section className="v2-media-card" aria-label="集级媒体装配">
    <h2>集级媒体装配 · 静帧 Animatic</h2>
    <p>项目真实素材版本进入 V1 画面轨；当前播放器按 25 fps 显示图片静帧。视频、音轨和字幕不在此播放器内播放；正式导出未批准。</p>
    <p>当前项目 <code>{projectId}</code> · 集 <code>{episodeId}</code></p>
    {version && <p>{headReliable ? "已读回版本" : "上次读回版本，当前 head 未核实"} <code>{version.version_id}</code> · {version.playback_status} · {version.export_status}</p>}
    {!editable && <p role="status">现有版本含视频、音频、字幕或不同帧率；静帧编辑器只读显示，不覆盖这些轨道。</p>}
    {!library && <p role="status">项目图片素材未能可靠读回；请刷新核对。</p>}
    {notice && <p role="status">{notice}</p>}
    <div>
      <Button disabled={busy} onClick={() => void load()}>重新读取装配与素材</Button>
      {writeUnknown && <span> 写入结果未知；已锁定再次保存。</span>}
    </div>
    {editable && <div>
      <label>选择已验证图片版本
        <select value={assetChoice} onChange={(event) => setAssetChoice(event.target.value)}>
          <option value="">选择素材</option>
          {choices.map(({ asset, version: item, value }) =>
            <option key={value} value={value}>{item.filename} · {item.id} · {item.rights_status}</option>)}
        </select>
      </label>
      <Button disabled={!assetChoice || busy || writeUnknown} onClick={addStill}>加入 V1 静帧轨</Button>
    </div>}
    <ol aria-label="V1 静帧镜头">
      {stills.map((shot, index) => {
        const asset = library?.find((item) => item.id === shot.media.asset_id);
        const item = asset?.versions.find((candidate) => candidate.id === shot.media.asset_version_id);
        return <li key={`${index}/${key(shot.media)}`}>
          {index + 1}. {item?.filename ?? shot.media.asset_version_id} · {shot.frames} 帧
          {editable && <>
            <label>时长（帧）
              <input type="number" min={1} max={750} value={shot.frames}
                disabled={busy || writeUnknown}
                onChange={(event) => changeStill(index, {
                  ...shot, frames: Number(event.target.value),
                })} />
            </label>
            <Button disabled={index === 0 || busy || writeUnknown}
              onClick={() => setStills((old) => {
                const next = [...old];
                [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                return next;
              })}>上移</Button>
            <Button disabled={busy || writeUnknown} onClick={() => changeStill(index, null)}>移除</Button>
          </>}
        </li>;
      })}
    </ol>
    <div aria-label="静帧 Animatic 播放器">
      {image && canPlay ? <img src={image} alt={`静帧 ${frame + 1} / ${totalFrames}`}
        onError={() => { setPlaying(false); setPreviewReady(false); }}
        style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain" }} /> :
        <p>当前静帧不可播放：请核对素材原始字节、哈希、权利状态及装配探测结果。</p>}
      <div>
        <Button disabled={!canPlay} onClick={() => {
          if (frame >= totalFrames - 1) setFrame(0);
          setPlaying((old) => !old);
        }}>{playing ? "暂停" : "播放静帧"}</Button>
        <label>帧 {frame + 1} / {totalFrames}
          <input type="range" min={0} max={Math.max(0, totalFrames - 1)} value={frame}
            disabled={!canPlay} onChange={(event) => {
              setPlaying(false);
              setFrame(Number(event.target.value));
            }} />
        </label>
      </div>
    </div>
    {editable && <Button primary disabled={busy || !headReliable || writeUnknown || !stills.length ||
      stills.some((shot) => !Number.isSafeInteger(shot.frames) ||
        shot.frames < 1 || shot.frames > 750)}
      onClick={() => void save()}>保存集级媒体装配版本</Button>}
  </section>;
}
