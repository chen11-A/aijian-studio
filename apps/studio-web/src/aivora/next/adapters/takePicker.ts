import { MAX_TAKES, type TakeOption, type TakePickerProps } from "../TakePicker";
import { mediaUrl } from "./media";
import { isCancelled, shotName, takeInUse } from "./names";
import { readProject, type ProjectTake } from "./read";
import { unreadable, type Adapted } from "./result";

export type TakePickerData = Pick<
  TakePickerProps,
  "shotLabel" | "shotCode" | "description" | "takes" | "aiChoiceId" | "selectedId" | "aspect"
>;

export type TakePickerOptions = {
  /** Turns a saved still path into an address an <img> can load. Defaults to mediaUrl. */
  mediaUrl?: (path: string) => string;
};

const RANK: Record<ProjectTake["status"], number> = { done: 1, running: 2, queued: 2, failed: 3 };

function option(take: ProjectTake, position: number, toUrl: (path: string) => string): TakeOption {
  const label = `第 ${take.index ?? position} 版`;
  const imageUrl = toUrl(take.stillUrl);
  // 4A-U03: a finished take shows its video, so the versions can play side by side.
  const videoUrl = take.status === "done" ? toUrl(take.videoUrl || take.videoPath) : "";
  const shown = { ...(imageUrl ? { imageUrl } : {}), ...(videoUrl ? { videoUrl } : {}) };
  if (take.status === "done") return { id: take.id, label, ...shown };
  if (take.status === "failed") {
    return {
      id: take.id,
      label,
      status: "failed",
      statusText: take.reason || "没有做成",
      ...shown,
    };
  }
  return {
    id: take.id,
    label,
    status: "generating",
    statusText: take.status === "queued" ? "排队中" : "正在生成",
    ...shown,
  };
}

/**
 * TakePicker props for one shot. At most three versions are shown, chosen in this order: the
 * one the export uses, then finished ones, then ones still being made, then failed ones, newest
 * first within each; they are then shown by version number. 「正在用这一版」 marks the take the
 * export uses. project.json has no AI pick and no review of a take, so neither is shown.
 */
export function takePickerData(
  value: unknown,
  shotId: string,
  options: TakePickerOptions = {},
): Adapted<TakePickerData> {
  const read = readProject(value);
  if (!read.ok) return unreadable(read.reason);
  const project = read.project;
  const shot = project.shots.find((item) => item.id === shotId);
  if (!shot) {
    return {
      ok: false,
      empty: { title: "找不到这个镜头", detail: `作品里没有编号为 ${shotId} 的镜头。` },
      missing: project.missing,
    };
  }
  const inUse = takeInUse(shot);
  const ranked = shot.takes
    .map((take, index) => ({ take, position: index + 1 }))
    .filter(({ take }) => !isCancelled(take))
    .sort(
      (a, b) =>
        (a.take === inUse ? 0 : RANK[a.take.status]) -
          (b.take === inUse ? 0 : RANK[b.take.status]) || b.position - a.position,
    )
    .slice(0, MAX_TAKES)
    .sort((a, b) => a.position - b.position);
  if (ranked.length === 0) {
    return {
      ok: false,
      empty: {
        title: "这个镜头还没有版本",
        detail: "在分镜里点「生成视频」，做好的版本会排在这里。",
      },
      missing: project.missing,
    };
  }
  const toUrl = options.mediaUrl ?? mediaUrl;
  return {
    ok: true,
    props: {
      shotLabel: [
        shotName(project, shot),
        shot.size,
        shot.seconds === null ? "" : `${shot.seconds} 秒`,
      ]
        .filter(Boolean)
        .join(" · "),
      shotCode: shot.id,
      ...(shot.picture || shot.action ? { description: shot.picture || shot.action } : {}),
      takes: ranked.map(({ take, position }) => option(take, position, toUrl)),
      aiChoiceId: null,
      selectedId: inUse?.id ?? null,
      ...(project.aspectRatio ? { aspect: project.aspectRatio } : {}),
    },
    missing: project.missing,
  };
}
