import type { ApplyBundledFilmShotAudioInput } from "@aijian/contracts/film-audio-library";
import { audioSuggestionGroupInputs } from "@aijian/contracts/film-audio-suggestion-group";
import { upgradeFilm, type FilmProject } from "../../film/project";
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
import { verifiedAudioGroup } from "./audio-suggestion-proof";
import { shotAudioInputKey, type ShotAudioPlan } from "./shot-audio-suggestions";
const failures: Record<string, string> = {
  PLAN_UNSUPPORTED: "这份建议暂时无法完整加入，请核对轨数与声音设置；没有截掉后面的片段。",
  LIBRARY_UNAVAILABLE: "本地素材目录暂时不可用，请重新查看建议。",
  ASSET_CHANGED: "素材或匹配规则已变化，请重新查看建议。",
  PROJECT_CHANGED: "作品、选版或建议输入已变化，请重新查看建议。",
  SOURCE_UNVERIFIED: "所选视频来源暂时无法核验，尚不能选用建议。",
  TOOLS_UNAVAILABLE: "本机媒体工具暂时不可用，请稍后重试。",
  BUSY: "本机正在处理这部作品，请完成后再试。",
};
export async function applyShotAudioGroup(
  host: LibraryHost,
  plan: ShotAudioPlan,
  inputKey: string,
  lanes: readonly ApplyBundledFilmShotAudioInput["lanes"][number][],
): Promise<LibraryOutcome> {
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
          shotAudioInputKey(base, selection) !== inputKey ||
          plan.projectId !== base.id ||
          plan.shotId !== selection.shotId ||
          plan.takeId !== selection.takeId
        )
          return { kind: "stale", message: "作品或镜头已变化，请重新查看建议后再选用。" };
        if (!bridge?.applyBundledFilmShotAudio)
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
        if (!prepared.valid() || shotAudioInputKey(host.current(), host.selection()) !== inputKey)
          return { kind: "stale", message: "本镜内容已变化，本次没有选用，请重新查看建议。" };
        const input: ApplyBundledFilmShotAudioInput = {
          projectId: base.id,
          expectedProjectHash: prepared.hash,
          shotId: selection.shotId,
          takeId: selection.takeId,
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
          const result = await bridge.applyBundledFilmShotAudio(input);
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
/** Removes only a fully verified current group. It never deletes source/copied media. */
export async function removeShotAudioGroup(
  host: LibraryHost,
  snapshot: FilmProject,
  groupId: string,
): Promise<LibraryOutcome> {
  let lease: FilmSaveLease | undefined;
  return await withAudioWriteCleanup(
    host,
    async () => {
      try {
        if (host.current() !== snapshot || host.persistence.externalWriteState(snapshot.id))
          return { kind: "stale", message: "作品或保存状态已变化，请先核对后再移除。" };
        const selection = host.selection();
        const initial = audioSuggestionGroupInputs(snapshot.audioClips, groupId),
          proof = await verifiedAudioGroup(snapshot.audioClips, groupId);
        if (!initial || !proof || host.current() !== snapshot)
          return { kind: "stale", message: "这组声音已有片段缺失或改过，不能作为完整组移除。" };
        lease = await host.persistence.acquire(snapshot.id);
        if (
          host.current() !== snapshot ||
          JSON.stringify(host.selection()) !== JSON.stringify(selection) ||
          JSON.stringify(audioSuggestionGroupInputs(snapshot.audioClips, groupId)) !==
            JSON.stringify(initial)
        )
          return { kind: "stale", message: "这组声音又有变化，本次没有移除。" };
        const ids = new Set(proof.members.map((m) => m.clipId));
        const adopted = host.apply({
          ...snapshot,
          audioClips: snapshot.audioClips.filter((c) => !ids.has(c.id)),
        });
        await lease.save(adopted, () => host.current() === adopted);
        return {
          kind: "removed",
          message: `已移除本次 ${proof.memberCount} 段声音引用并保存，素材文件和其他声音仍保留。`,
        };
      } catch {
        return { kind: "failed", message: "移除后的编辑还没保存上，请核对本页后重试保存。" };
      }
    },
    () => lease,
    () => undefined,
  );
}
