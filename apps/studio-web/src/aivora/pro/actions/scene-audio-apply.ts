import type { ApplyBundledFilmSceneAudioInput } from "@aijian/contracts/film-audio-library";
import { upgradeFilm } from "../../film/project";
import type { FilmSaveLease } from "../film-persistence";
import {
  readBackLibraryWrite,
  prepareLibraryInput,
  requireAudioExternal,
  settleLibraryWrite,
  withAudioWriteCleanup,
  type PendingGroupLibraryWrite,
  type LibraryHost,
  type LibraryOutcome,
} from "./audio-library";
import { removeShotAudioGroup } from "./shot-audio-apply";
import {
  sceneAudioInputKey,
  sceneAudioSelection,
  type SceneAudioPlan,
  type SceneAudioHost,
} from "./scene-audio-suggestions";
const failures: Record<string, string> = {
  PLAN_UNSUPPORTED: "这份建议暂时无法完整加入，请核对轨数与声音设置；没有截掉后面的片段。",
  LIBRARY_UNAVAILABLE: "本地素材目录暂时不可用，请重新查看建议。",
  ASSET_CHANGED: "素材或匹配规则已变化，请重新查看建议。",
  PROJECT_CHANGED: "作品、选版或建议输入已变化，请重新查看建议。",
  SOURCE_UNVERIFIED: "所选视频来源暂时无法核验，尚不能选用建议。",
  TOOLS_UNAVAILABLE: "本机媒体工具暂时不可用，请稍后重试。",
  BUSY: "本机正在处理这部作品，请完成后再试。",
};
export async function applySceneAudioGroup(
  sceneHost: SceneAudioHost,
  plan: SceneAudioPlan,
  inputKey: string,
  lanes: readonly ApplyBundledFilmSceneAudioInput["lanes"][number][],
): Promise<LibraryOutcome> {
  const scope = sceneHost.sceneSelection();
  const film = sceneHost.current();
  const first = film?.shots.find((shot) => shot.sceneId === scope?.sceneId);
  const anchor =
    first && film && scope
      ? { projectId: film.id, page: scope.page, shotId: first.id, takeId: first.selectedTakeId }
      : null;
  if (!scope || !anchor?.takeId)
    return { kind: "stale", message: "当前场次或选版已变化，请重新查看建议。" };
  const host: LibraryHost = {
    ...sceneHost,
    selection: () =>
      JSON.stringify(sceneHost.sceneSelection()) === JSON.stringify(scope) ? anchor : null,
  };
  let lease: FilmSaveLease | undefined, pending: PendingGroupLibraryWrite | undefined;
  return await withAudioWriteCleanup(
    host,
    async () => {
      try {
        const base = host.current(),
          selection = host.selection(),
          bridge = window.aijian;
        if (
          !base ||
          !selection ||
          sceneAudioInputKey(base, sceneHost.sceneSelection()) !== inputKey ||
          plan.projectId !== base.id ||
          plan.sceneId !== scope.sceneId ||
          JSON.stringify(plan.clock.shots.map(({ shotId, takeId }) => ({ shotId, takeId }))) !==
            JSON.stringify(sceneAudioSelection(base))
        )
          return { kind: "stale", message: "作品或场次已变化，请重新查看建议后再选用。" };
        if (!bridge?.applyBundledFilmSceneAudio)
          return { kind: "failed", message: "当前桌面版本不支持整组选用声音建议，请更新后再试。" };
        if (
          !lanes.length ||
          new Set(lanes).size !== lanes.length ||
          lanes.some(
            (lane) =>
              !["ambience", "sfx", "score"].includes(lane) ||
              !plan.clips.some((c) => c.lane === lane),
          )
        )
          return {
            kind: "failed",
            message: "请明确选择至少一条有建议的声音轨道；每条轨道会保留完整片段。",
          };
        lease = await host.persistence.acquire(base.id);
        const prepared = await prepareLibraryInput(base, selection, host, lease);
        if (
          !prepared.valid() ||
          sceneAudioInputKey(host.current(), sceneHost.sceneSelection()) !== inputKey
        )
          return { kind: "stale", message: "本场内容已变化，本次没有选用，请重新查看建议。" };
        const input: ApplyBundledFilmSceneAudioInput = {
          projectId: base.id,
          expectedProjectHash: prepared.hash,
          sceneId: scope.sceneId,
          expectedSelection: sceneAudioSelection(prepared.accepted)!,
          catalogSha256: plan.catalogSha256,
          pickerSha256: plan.pickerSha256,
          planFingerprint: plan.planFingerprint,
          lanes: [...lanes],
        };
        pending = {
          kind: "group",
          before: prepared.accepted,
          canonicalBefore: prepared.stored,
          rawBefore: prepared.rawStored,
          hash: prepared.hash,
          selection,
          input,
          plan: structuredClone(plan),
          settled: false,
        };
        const external = requireAudioExternal(lease);
        external.begin(prepared.valid);
        try {
          const result = await bridge.applyBundledFilmSceneAudio(input);
          pending.settled = true;
          if (result.kind === "ADDED") {
            pending.receiptClaimed = true;
            pending.expectedReceipt = result.receipt;
            const saved = upgradeFilm(result.project);
            if (!saved || saved.id !== base.id) {
              external.unknown();
              return {
                kind: "unknown",
                message: "本次配声写入尚未确认，编辑副本已保留，请核对后再操作。",
                pending,
              };
            }
            return await settleLibraryWrite(host, pending, lease, saved, result.project);
          }
          const checked = await readBackLibraryWrite(host, pending, lease);
          return checked.kind === "failed" &&
            result.unchanged === true &&
            Object.hasOwn(failures, result.code)
            ? { ...checked, message: failures[result.code]! }
            : checked;
        } catch {
          external.unknown();
          return await readBackLibraryWrite(host, pending, lease);
        }
      } catch {
        return pending && host.persistence.externalWriteState(pending.before.id)
          ? {
              kind: "unknown",
              message: "本次配声保存结果尚未确认，请先核对，不要重复选用。",
              pending,
            }
          : { kind: "failed", message: "尚未开始选用声音建议，请检查当前作品的保存状态。" };
      }
    },
    () => lease,
    () => pending,
  );
}

/** Full-group removal reuses the existing global digest/ID proof; no file is removed. */
export async function removeSceneAudioGroup(
  host: SceneAudioHost,
  groupId: string,
): Promise<LibraryOutcome> {
  const scope = host.sceneSelection(),
    snapshot = host.current();
  if (
    !scope ||
    !snapshot ||
    !snapshot.audioClips.some(
      (c) =>
        c.suggestionGroup?.groupId === groupId && c.sceneAudioBinding?.sceneId === scope.sceneId,
    )
  )
    return { kind: "stale", message: "当前场次或声音组已变化，本次没有移除。" };
  const selected = host.selection();
  return await removeShotAudioGroup(
    {
      ...host,
      selection: () =>
        JSON.stringify(host.sceneSelection()) === JSON.stringify(scope) ? selected : null,
    },
    snapshot,
    groupId,
  );
}
