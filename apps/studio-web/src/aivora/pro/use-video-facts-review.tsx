import { useEffect, useRef, useState } from "react";
import type { FilmProject, FilmShot } from "../film/project";
import { compileSevenPartVideo, reviewedVideoText } from "../film/seven-part-video";
import { storyFilmBatches } from "../film/operations";
import { SevenPartVideoReview } from "../next/SevenPartVideoReview";
import { SkillMarkdownImport } from "./SkillMarkdownImport";
import type { createEditorHost } from "./actions/editor-host";
import type { EditorSelection } from "./actions/editor-context";

export function useVideoFactsReview({
  editorHost,
  current,
  selection,
  film,
  target,
}: {
  editorHost: ReturnType<typeof createEditorHost>;
  current: () => FilmProject | null;
  selection: () => EditorSelection;
  film: FilmProject | null;
  target: FilmShot | undefined;
}) {
  const [videoReview, setVideoReview] = useState<{
    request: NonNullable<ReturnType<typeof editorHost.capture>>;
    facts: ReturnType<typeof compileSevenPartVideo>;
    captureFactsKey: string;
    before: string | null;
    modelText: string;
    changed: boolean;
    result: "saved" | "unsaved" | "rejected" | null;
  } | null>(null);
  const [videoReviewBusy, setVideoReviewBusy] = useState(false);
  const videoReviewWorking = useRef(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const scope = `${film?.id}:${target?.id}:${selection().page}`;
  useEffect(() => setSkillOpen(false), [scope]);
  function videoReviewMatches(review: NonNullable<typeof videoReview>) {
    const live = current(),
      selected = selection();
    const origin = review.request.selection;
    const target = live?.shots.find((item) => item.id === origin.shotId);
    const compiled = live && target ? compileSevenPartVideo(live, target) : null;
    return !!(
      live &&
      target &&
      live.id === origin.projectId &&
      selected.page === origin.page &&
      selected.shotId === origin.shotId &&
      selected.sceneId === origin.sceneId &&
      compiled &&
      compiled.issues.length === 0 &&
      compiled.draft.factsKey ===
        (review.result === "saved" || review.result === "unsaved"
          ? review.facts.draft.factsKey
          : review.captureFactsKey)
    );
  }
  function organizeVideoFacts(guidance?: string) {
    if (videoReviewWorking.current) return;
    const request = editorHost.capture();
    const target = request?.base.shots.find((item) => item.id === request.selection.shotId);
    if (!request || !target) return;
    const captureFactsKey = compileSevenPartVideo(request.base, target).draft.factsKey;
    const candidate =
      guidance === undefined ? target : { ...target, videoFramingGuidance: guidance };
    const facts = compileSevenPartVideo(request.base, candidate);
    const proposed = {
      ...request.base,
      shots: request.base.shots.map((item) =>
        item.id === target.id ? { ...candidate, reviewedVideoPrompt: facts.draft } : item,
      ),
    };
    let modelText = "";
    if (!facts.issues.length) {
      try {
        modelText =
          storyFilmBatches(
            proposed,
            [proposed.shots.find((item) => item.id === target.id)!],
            proposed.draft,
          )[0]?.shots?.[0]?.prompt ?? "";
      } catch (error) {
        facts.issues.push(
          error instanceof Error &&
            /VOICE_.*REQUIRED/.test(String((error as { code?: string }).code))
            ? "台词的声音选择尚未完成，请先核对说话人和声音。"
            : "完整提交文本无法使用；请精简过长的说明，或调整时长、拆分镜头后重新整理。",
        );
      }
    }
    const diff = editorHost.preview(request, proposed);
    if (!diff || diff.unsupported.length) return;
    let before: string | null =
      target.reviewedVideoPrompt === undefined
        ? null
        : "原保存说明已过期或无法核对，暂不展示其内容。";
    try {
      const checked = reviewedVideoText(request.base, target);
      if (checked !== undefined) before = checked;
    } catch {
      /* No raw unverified body reaches the display. */
    }
    setVideoReview({
      request,
      captureFactsKey,
      facts,
      before,
      modelText,
      changed: diff.changes.length > 0,
      result: null,
    });
  }
  async function confirmVideoFacts() {
    const review = videoReview;
    if (
      !review ||
      !review.changed ||
      videoReviewWorking.current ||
      review.result ||
      review.facts.issues.length
    )
      return;
    if (!videoReviewMatches(review)) {
      setVideoReview((current) =>
        current?.request.id === review.request.id ? { ...current, result: "rejected" } : current,
      );
      return;
    }
    videoReviewWorking.current = true;
    setVideoReviewBusy(true);
    try {
      const result = await editorHost.apply(review.request.id);
      if (result.completionCurrent === false) return;
      setVideoReview((current) =>
        current?.request.id === review.request.id
          ? {
              ...current,
              result:
                result.status === "saved"
                  ? "saved"
                  : result.status === "applied_unsaved"
                    ? "unsaved"
                    : "rejected",
            }
          : current,
      );
    } finally {
      videoReviewWorking.current = false;
      setVideoReviewBusy(false);
    }
  }

  const tools = (
    <>
      <div className="acts video-review-actions">
        <button className="btn" disabled={videoReviewBusy} onClick={() => organizeVideoFacts()}>
          整理视频说明
        </button>
        {target && (
          <button className="btn" disabled={videoReviewBusy} onClick={() => setSkillOpen(true)}>
            导入 SKILL.md
          </button>
        )}
      </div>
      {videoReview &&
      videoReview.request.selection.projectId === film?.id &&
      videoReview.request.selection.shotId === target?.id ? (
        <SevenPartVideoReview
          facts={videoReview.facts}
          changed={videoReview.changed}
          before={videoReview.before}
          modelText={videoReview.modelText}
          busy={videoReviewBusy}
          stale={!videoReviewMatches(videoReview)}
          result={
            videoReview.result &&
            videoReview.result !== "rejected" &&
            target?.reviewedVideoPrompt?.factsKey !== videoReview.facts.draft.factsKey
              ? "undone"
              : videoReview.result
          }
          onConfirm={() => void confirmVideoFacts()}
          onDismiss={() => {
            if (!videoReviewWorking.current) setVideoReview(null);
          }}
        />
      ) : null}
    </>
  );
  const closeSkill = () => setSkillOpen(false);
  const dialog = skillOpen && target && (
    <div className="dialog-back">
      <SkillMarkdownImport
        key={scope}
        disabled={videoReviewBusy}
        onPreview={(guidance) => {
          organizeVideoFacts(guidance);
          closeSkill();
        }}
        onDraftChange={() => setVideoReview(null)}
        onClose={closeSkill}
      />
    </div>
  );
  return { tools, dialog };
}
