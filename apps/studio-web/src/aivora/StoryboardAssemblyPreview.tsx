import { useEffect, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import { Button } from "./Common";
import { SavedCompositionPreview } from "./SavedCompositionPreview";
import type { StoryboardVersion } from "./adapters/episodeStoryboard";
import type { AssemblyVersion } from "./adapters/episodeMediaAssembly";
import {
  readStoryboardAssembly,
  storyboardAssemblyLinks,
} from "./adapters/storyboardAssemblyPreview";

type Props = {
  projectId: string;
  episodeId: string;
  version: StoryboardVersion | null;
  dirty: boolean;
  disabled: boolean;
};
const availabilityLabels = {
  VERIFIED: "原件校验通过",
  MISSING: "原件丢失",
  CORRUPT: "原件损坏",
  UNVERIFIED_SIZE_LIMIT: "原件超出校验大小限制",
  UNKNOWN_UNSAFE_PATH: "原件路径无法安全读取",
  UNKNOWN_MEDIA_READ: "原件读取结果未知",
  UNKNOWN_MEDIA_CHANGED: "原件已变更，需重新核对",
};
const technicalLabels = {
  STILL_HEADER_ONLY: "静态图片头检查",
  PENDING_MEDIA_PROBE: "技术探测待完成",
  PROBED_CFR_VIDEO: "视频恒定帧率探测通过",
  INVALID_MEDIA_PROBE: "技术探测不符合要求",
};
const rightsLabels = {
  PENDING_REVIEW: "权利待审核",
  CLEARED: "权利已登记通过",
  RESTRICTED: "权利受限",
};
const audioLabels = { DIALOGUE: "对白", BGM: "背景音乐", SFX: "音效" };

/** Remount each immutable input, including A→B→A; pending replies cannot cross scopes. */
export function StoryboardAssemblyPreview(props: Props) {
  const scope = `${props.projectId}:${props.episodeId}:${props.version?.version_id}:${props.version?.content_hash}`;
  return <ScopedStoryboardAssemblyPreview key={scope} {...props} />;
}

function ScopedStoryboardAssemblyPreview(props: Props) {
  const [transport] = useState(createStudioTransport);
  const [assembly, setAssembly] = useState<AssemblyVersion | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "found" | "empty" | "unknown">("idle");
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const live = useRef(props);
  live.current = props;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const version = props.version;
  const scoped = version?.project_id === props.projectId && version?.episode_id === props.episodeId;
  const ready = !!transport.episodeMediaAssembly && !!version && scoped;
  async function read() {
    if (inFlight.current || props.disabled || !ready || !version) return;
    inFlight.current = true;
    setStatus("loading");
    const result = await readStoryboardAssembly(transport.episodeMediaAssembly!, version);
    if (!mounted.current) return;
    inFlight.current = false;
    if (live.current.disabled) {
      setStatus("unknown");
      return;
    }
    if (result.kind === "FOUND") {
      setAssembly(result.assembly);
      setStatus("found");
    } else setStatus(result.kind === "EMPTY" ? "empty" : "unknown");
  }
  const links = version && assembly ? storyboardAssemblyLinks(version, assembly) : null;
  return (
    <section className="storyboard-text-preview" aria-label="分镜关联装配预览">
      <h3>分镜关联画面与声音</h3>
      <p>
        从本集已保存装配读取实际素材和镜头关联。逐项检查后可播放对应版本的 DRAFT
        MP4；文字预演、当前未保存分镜和装配编辑不包含在该视频中。
      </p>
      {version && scoped && <p>分镜输入版本：{version.version_id}</p>}
      {props.dirty && <p role="status">分镜有未保存修改：这里只核对上次保存的分镜版本。</p>}
      {!ready && <p>需要已保存的本集分镜和支持本地装配读取的桌面软件。</p>}
      <Button
        disabled={!ready || props.disabled || status === "loading"}
        onClick={() => void read()}
      >
        {status === "loading" ? "正在读取关联装配…" : "读取本集已保存装配"}
      </Button>
      {status === "empty" && (
        <p role="status">本集当前没有已保存装配；请先在组装页选用真实素材并关联镜头。</p>
      )}
      {status === "unknown" && (
        <p role="alert">装配核对结果未知；不会读取其他分集或回退到其他版本，请显式重新读取。</p>
      )}
      {assembly && links && (
        <>
          {status !== "found" && <p role="status">以下是上次核对的历史记录，当前读取尚未确认。</p>}
          <p>装配输入版本：{assembly.version_id}</p>
          <p>装配内容哈希：{assembly.content_hash}</p>
          <p>
            已关联镜头：{links.linked} / {links.shots.length} · 声音片段：
            {assembly.content.audio_segments.length}
          </p>
          <p>
            装配时间基：{assembly.content.sequence_timebase.frame_rate.num}/
            {assembly.content.sequence_timebase.frame_rate.den} fps ·{" "}
            {assembly.content.total_frames} 帧 · 字幕片段：
            {assembly.content.subtitle_segments.length}
          </p>
          <ol>
            {links.shots.map(({ shot, segments, durationMatches }) => (
              <li key={shot.shot_id}>
                <strong>
                  {shot.ordinal}. {shot.title || "未命名镜头"}
                </strong>
                <p>
                  {shot.shot_id} · {segments.length} 个精确关联画面片段
                </p>
                {segments.length > 0 && !durationMatches && (
                  <p>装配中本镜累计时长与分镜计划不同。</p>
                )}
                {segments.map((segment) => (
                  <p key={segment.segment_id}>
                    {segment.segment_id} · [{segment.start_frame}, {segment.end_frame}) 帧 ·{" "}
                    {segment.media_kind} · 素材版本 {segment.media.asset_version_id}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          {assembly.content.audio_segments.map((segment) => (
            <p key={segment.segment_id}>
              声音 {audioLabels[segment.track_kind]} · [{segment.start_frame}, {segment.end_frame})
              帧 · 素材版本 {segment.media.asset_version_id}
              {segment.track_kind === "DIALOGUE" && (
                <>
                  {" "}
                  · 剧本 {segment.script_version_id} · 对白 {segment.script_block_id} · 发言角色{" "}
                  {segment.speaker_id}
                </>
              )}
            </p>
          ))}
          {assembly.media_checks.map((check) => (
            <p key={`${check.media.asset_version_id}:${check.media.sha256}`}>
              素材 {check.media.asset_version_id} · {availabilityLabels[check.availability]} ·{" "}
              {technicalLabels[check.technical_status]} · {rightsLabels[check.rights_status]}
            </p>
          ))}
          {links.unmatched.length > 0 && (
            <p role="alert">
              {links.unmatched.length}{" "}
              个画面片段未关联此精确分镜版本；请在组装页检查其分镜版本和镜头。
            </p>
          )}
          {!links.orderMatches && <p>装配镜头次序与分镜计划不同，预览采用已保存装配的实际次序。</p>}
          {!links.canPreview && <p>全部镜头和画面片段精确关联此版本后，才可在这里预览。</p>}
          {status === "found" && links.canPreview && !props.disabled && (
            <SavedCompositionPreview
              projectId={props.projectId}
              episodeId={props.episodeId}
              savedVersion={assembly}
              dirty={false}
              disabled={false}
              exports={transport.draftExports}
            />
          )}
          <p>
            关联数量只说明保存的引用，不代表画面覆盖、权利、声音、口型或正式审片已经通过。实时预演与正式
            Animatic 仍待接入。
          </p>
        </>
      )}
    </section>
  );
}
