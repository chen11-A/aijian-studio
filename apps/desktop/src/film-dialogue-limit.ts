import { createHash, randomUUID } from "node:crypto";
import {
  canonicalDialogueLines,
  canonicalShotVoiceId,
  dialogueVideoCap,
  dialogueEvidenceContext,
} from "@aijian/contracts/film-dialogue-split-plan";
import type { StoryFilmLocalScope } from "@aijian/contracts/film-dialogue-split";
import { filmHistoryRecordHash } from "./film-history";
import { readProject, type FilmRecord } from "./film-library";
import type { StoryFilmCreateInput } from "./story-film-client";
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function parseStoryFilmLocalScope(value: unknown): StoryFilmLocalScope {
  const v = object(value);
  if (
    !v ||
    Object.keys(v).sort().join() !== "inputFingerprint,projectId,shotId,takeId" ||
    typeof v.projectId !== "string" ||
    !/^film_[a-z0-9]{16,40}$/.test(v.projectId) ||
    !digest(v.inputFingerprint) ||
    ![v.shotId, v.takeId].every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 160 && !id.includes("\0"),
    )
  )
    throw Error("Invalid story film local scope");
  return v as unknown as StoryFilmLocalScope;
}
/** Full actual request signature, matching the service's ordered UTF-8 array digest. */
export function dialogueRequestSignature(body: StoryFilmCreateInput) {
  if (body.shots && body.shots.length !== 1) return null;
  const shot = body.shots?.[0];
  return sha([
    body.video_model || "grok-imagine-video-1.5",
    shot?.voice_id?.trim() || body.voice_id || "eve",
    shot?.delivery?.trim() || "",
    (shot?.narration ?? body.narration).trim(),
    (shot?.lines ?? []).map((line) => [line.speaker.trim(), line.text, line.voice_id ?? ""]),
    "grok-tts",
  ]);
}
function target(record: FilmRecord, scope: StoryFilmLocalScope) {
  if (record.id !== scope.projectId || !Array.isArray(record.shots)) return null;
  const matches = record.shots.filter((v) => object(v)?.id === scope.shotId);
  if (matches.length !== 1) return null;
  const shot = object(matches[0])!;
  if (!Array.isArray(shot.takes)) return null;
  const takes = shot.takes.filter((v) => object(v)?.id === scope.takeId);
  if (takes.length !== 1 || object(takes[0])?.shotId !== scope.shotId) return null;
  return { shot, take: object(takes[0])! };
}
function semantic(record: FilmRecord, scope: StoryFilmLocalScope) {
  return filmHistoryRecordHash(dialogueEvidenceContext(record, scope.shotId, scope.takeId));
}

type Entry = {
  owner: number;
  scope: StoryFilmLocalScope;
  semantic: string;
  selection: string;
  expires: number;
  requiredSeconds: number;
  maxSeconds: 10 | 15;
  rawAudioSaved: boolean;
};
/** Session-only authorization minted exclusively from this owner's actual API reply. */
export function createDialogueLimitRegistry(host: {
  filmsRoot: string;
  now?: () => number;
  read?: typeof readProject;
}) {
  const ownerEpochs = new Map<number, number>();
  const entries = new Map<string, Entry>(),
    now = host.now ?? Date.now;
  const prune = () => {
    for (const [id, value] of entries) if (value.expires <= now()) entries.delete(id);
  };
  return {
    async mint(
      owner: number,
      backendProjectId: string,
      body: StoryFilmCreateInput,
      scope: StoryFilmLocalScope,
      result: unknown,
    ): Promise<string | null> {
      const data = object(object(result)?.data),
        fact = object(data?.dialogue_limit);
      if (
        data?.status !== "FAILED" ||
        !fact ||
        fact.schema_version !== 1 ||
        fact.speech_window !== 1 ||
        fact.target_video_submitted !== false ||
        fact.shot_index !== (body.shots?.length ? 1 : null) ||
        !digest(fact.request_sha256) ||
        fact.request_sha256 !== dialogueRequestSignature(body) ||
        ![10, 15].includes(Number(fact.max_seconds)) ||
        typeof fact.required_seconds !== "number" ||
        !Number.isFinite(fact.required_seconds) ||
        fact.required_seconds <= Number(fact.max_seconds) ||
        fact.required_seconds > 36001 ||
        typeof fact.raw_audio_saved !== "boolean" ||
        (fact.raw_audio_saved ? !digest(fact.raw_audio_sha256) : fact.raw_audio_sha256 !== null)
      )
        return null;
      if (
        fact.max_seconds !==
        dialogueVideoCap(
          body.video_model || "grok-imagine-video-1.5",
          !!(
            body.shots?.[0]?.still ||
            body.shots?.[0]?.reference ||
            body.shots?.[0]?.references?.length
          ),
        )
      )
        return null;
      const notice = object(data.user_message);
      if (notice?.code !== "DIALOGUE_VIDEO_LIMIT") return null;
      const epoch = ownerEpochs.get(owner) ?? 0;
      const record = await (host.read ?? readProject)(host.filmsRoot, scope.projectId);
      if ((ownerEpochs.get(owner) ?? 0) !== epoch) return null;
      if (!record || record.backendProjectId !== backendProjectId) return null;
      const found = target(record, scope);
      if (
        !found ||
        found.take.status !== "running" ||
        semantic(record, scope) !== scope.inputFingerprint
      )
        return null;
      const shot = found.shot as unknown as Parameters<typeof canonicalDialogueLines>[0];
      const lines = canonicalDialogueLines(shot);
      const child = body.shots?.[0];
      const narration =
        lines
          .map((line) => line.text)
          .join("\n")
          .replace(/\s+/g, " ")
          .trim() || "。";
      const model =
        record.draft === true ? "grok-imagine-video-1.5-lite" : "grok-imagine-video-1.5";
      if (
        (child?.narration ?? body.narration).trim() !== narration ||
        (body.video_model || "grok-imagine-video-1.5") !== model
      )
        return null;
      const voices = {
        characters: (Array.isArray(record.characters) ? record.characters : []) as {
          name: string;
          voiceId: string;
        }[],
        narrationVoiceId:
          typeof record.narrationVoiceId === "string" ? record.narrationVoiceId : "",
      };
      const expected = lines.map((line) => ({
        ...line,
        voice_id: canonicalShotVoiceId(
          { ...shot, line: line.text, speaker: line.speaker, lines: [line] },
          voices,
        ),
      }));
      if (
        child
          ? JSON.stringify(
              (child.lines ?? []).map((line) => [line.speaker, line.text, line.voice_id ?? ""]),
            ) !==
              JSON.stringify(
                expected.map((line) => [line.speaker.trim(), line.text, line.voice_id]),
              ) ||
            (child.voice_id || body.voice_id || "eve") !== (expected[0]?.voice_id || "eve") ||
            (child.delivery?.trim() || "") !==
              String(found.shot.delivery ?? "")
                .trim()
                .slice(0, 400)
          : (body.voice_id || "eve") !==
            (expected[0]?.voice_id || canonicalShotVoiceId(shot, voices) || "eve")
      )
        return null;
      prune();
      while (entries.size >= 64) entries.delete(entries.keys().next().value!);
      const id = `dle_${randomUUID().replaceAll("-", "")}`;
      entries.set(id, {
        owner,
        scope: { ...scope },
        semantic: semantic(record, scope),
        selection:
          found.shot.selectedTakeId === scope.takeId ? "" : String(found.shot.selectedTakeId ?? ""),
        expires: now() + 30 * 60_000,
        requiredSeconds: fact.required_seconds,
        maxSeconds: fact.max_seconds as 10 | 15,
        rawAudioSaved: fact.raw_audio_saved,
      });
      return id;
    },
    verify(owner: number, id: string, record: FilmRecord, shotId: string) {
      prune();
      const entry = entries.get(id);
      if (
        !entry ||
        entry.owner !== owner ||
        entry.scope.projectId !== record.id ||
        entry.scope.shotId !== shotId
      )
        return null;
      const found = target(record, entry.scope);
      if (
        !found ||
        found.take.status !== "failed" ||
        String(found.shot.selectedTakeId ?? "") !== entry.selection ||
        semantic(record, entry.scope) !== entry.semantic
      )
        return null;
      return {
        requiredSeconds: entry.requiredSeconds,
        maxSeconds: entry.maxSeconds,
        rawAudioSaved: entry.rawAudioSaved,
      };
    },
    guardOwner(owner: number) {
      const epoch = ownerEpochs.get(owner) ?? 0;
      return () => (ownerEpochs.get(owner) ?? 0) === epoch;
    },
    consume(id: string) {
      entries.delete(id);
    },
    disposeOwner(owner: number) {
      ownerEpochs.set(owner, (ownerEpochs.get(owner) ?? 0) + 1);
      for (const [id, entry] of entries) if (entry.owner === owner) entries.delete(id);
    },
  };
}
/** Safe informational facts only. These numbers cannot replace a live registry receipt. */
export function publicDialogueLimit(value: unknown): Record<string, unknown> | null {
  const v = object(value);
  if (
    !v ||
    v.schema_version !== 1 ||
    v.speech_window !== 1 ||
    v.target_video_submitted !== false ||
    typeof v.required_seconds !== "number" ||
    !Number.isFinite(v.required_seconds) ||
    v.required_seconds <= 0 ||
    v.required_seconds > 36001 ||
    ![10, 15].includes(Number(v.max_seconds)) ||
    typeof v.raw_audio_saved !== "boolean" ||
    !(
      v.shot_index === null ||
      (Number.isInteger(v.shot_index) && Number(v.shot_index) >= 1 && Number(v.shot_index) <= 10)
    )
  )
    return null;
  return {
    schema_version: 1,
    speech_window: 1,
    required_seconds: v.required_seconds,
    max_seconds: v.max_seconds,
    shot_index: v.shot_index,
    target_video_submitted: false,
    raw_audio_saved: v.raw_audio_saved,
  };
}
