import { useEffect, useRef, useState } from "react";
import type { FilmProject } from "../film/project";
import { AudioSuggestionGroups, type AudioGroupView } from "./AudioSuggestionGroups";
import { verifiedAudioGroup } from "./actions/audio-suggestion-proof";
import { noteSceneSettlement, type LibraryOutcome } from "./actions/audio-library";
import { applySceneAudioGroup, removeSceneAudioGroup } from "./actions/scene-audio-apply";
import { ShotAudioSuggestionDialog } from "./ShotAudioSuggestionDialog";
import {
  readSceneAudioSuggestions,
  sceneAudioInputKey,
  type SceneAudioPlan,
  type SceneAudioHost,
} from "./actions/scene-audio-suggestions";
import { soundRowLabel, UNGENERATED_SOUND_LABEL } from "./sound-export-decision";
export function useSceneAudioSuggestions(
  film: FilmProject | null,
  enabled: boolean,
  host: SceneAudioHost,
  controller: {
    busy: boolean;
    pendingFor: (id: string) => boolean;
    runGroupOperation: (id: string, run: () => Promise<LibraryOutcome>) => Promise<LibraryOutcome>;
  },
) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const [selectedLanes, setSelectedLanes] = useState<("ambience" | "sfx" | "score")[]>([]),
    [applying, setApplying] = useState(false),
    [groups, setGroups] = useState<AudioGroupView[]>([]);
  const planKey = useRef("");
  const applyingRef = useRef(false);
  const confirmed = useRef<FilmProject | null>(null);
  const invalidated = useRef(false);
  const unsettled = useRef<string | null>(null);
  const generation = useRef(0),
    working = useRef(false);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<SceneAudioPlan | null>(null),
    [message, setMessage] = useState("");
  const selection = host.sceneSelection(),
    scope = JSON.stringify(selection),
    key = sceneAudioInputKey(film, selection);
  const previous = useRef({ scope, key, enabled });
  useEffect(() => {
    const last = previous.current;
    previous.current = { scope, key, enabled };
    if (last.scope === scope && last.key === key && last.enabled === enabled) return;
    const adopted = confirmed.current;
    const ours =
      enabled &&
      last.scope === scope &&
      last.key !== key &&
      adopted !== null &&
      film === adopted &&
      !invalidated.current;
    confirmed.current = null;
    generation.current++;
    setPlan(null);
    setBusy(false);
    if (last.scope !== scope || !enabled) {
      unsettled.current = null;
      invalidated.current = false;
      setOpen(false);
      setMessage("");
      return;
    }
    if (unsettled.current) {
      confirmed.current = null;
      setPlan(null);
      setBusy(false);
      return;
    }
    if (ours) {
      noteSceneSettlement("keep-result");
      return;
    }
    invalidated.current = true;
    noteSceneSettlement("invalidate");
    setMessage("场次、选版或素材已变化，请刷新后重新核对。");
  }, [scope, key, enabled, film]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function dropSettlement() {
    confirmed.current = null;
    invalidated.current = false;
    unsettled.current = null;
  }
  async function read() {
    dropSettlement();
    const base = hostRef.current.current();
    if (base && controllerRef.current.pendingFor(base.id)) {
      setPlan(null);
      setBusy(false);
      setMessage("此前声音添加的结果尚未确认，请先在本地素材保存状态中核对，不要重复选用。");
      return;
    }
    if (working.current) {
      setMessage("上一轮读取还在结束，请稍后刷新。");
      return;
    }
    working.current = true;
    const token = ++generation.current;
    setPlan(null);
    setBusy(true);
    setMessage("");
    try {
      const result = await readSceneAudioSuggestions(
        hostRef.current,
        () => generation.current === token,
      );
      if (generation.current !== token) return;
      if (result.kind === "ready") {
        planKey.current = result.inputKey;
        setSelectedLanes([]);
        setPlan(result.plan);
      } else
        setMessage(
          result.kind === "stale" ? "场次、选版或素材已变化，请刷新后重新核对。" : result.message,
        );
    } finally {
      working.current = false;
      if (generation.current === token) setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    const selected = hostRef.current.sceneSelection();
    const candidates =
      film?.audioClips.filter(
        (c) => c.sceneAudioBinding?.sceneId === selected?.sceneId && c.suggestionGroup,
      ) ?? [];
    const ids = [...new Set(candidates.map((c) => c.suggestionGroup!.groupId))];
    setGroups(
      ids.map((id) => ({
        id,
        count: candidates.filter((c) => c.suggestionGroup!.groupId === id).length,
        complete: false,
        lanes: "正在核对",
      })),
    );
    void Promise.all(
      ids.map(async (id) => {
        const clips = film!.audioClips.filter((c) => c.suggestionGroup?.groupId === id),
          receipt = await verifiedAudioGroup(film!.audioClips, id);
        return {
          id,
          count: clips.length,
          complete:
            !!receipt &&
            receipt.memberCount === clips.length &&
            clips.every((c) => c.sceneAudioBinding?.sceneId === selected?.sceneId),
          lanes: [
            ...new Set(
              clips.map((c) =>
                c.lane === "ambience" ? "环境音" : c.lane === "sfx" ? "音效" : "配乐",
              ),
            ),
          ].join("、"),
        };
      }),
    ).then((rows) => {
      if (active) setGroups(rows);
    });
    return () => {
      active = false;
    };
  }, [film, scope]);
  async function apply() {
    const h = hostRef.current,
      base = h.current(),
      captured = plan,
      applyScope = JSON.stringify(h.sceneSelection());
    if (!base || !captured || applyingRef.current || controllerRef.current.busy || working.current)
      return;
    applyingRef.current = true;
    dropSettlement();
    setApplying(true);
    noteSceneSettlement("clear");
    setMessage("");
    noteSceneSettlement("call");
    const capturedKey = sceneAudioInputKey(base, h.sceneSelection());
    try {
      const result = await controllerRef.current.runGroupOperation(base.id, () =>
        applySceneAudioGroup(h, captured, planKey.current, selectedLanes),
      );
      const scopeHeld = JSON.stringify(h.sceneSelection()) === applyScope;
      if (!scopeHeld) {
        confirmed.current = null;
      } else if (result.kind === "unknown" || result.kind === "failed") {
        confirmed.current = null;
        unsettled.current = result.message;
        setPlan(null);
        setSelectedLanes([]);
        setMessage(result.message);
        noteSceneSettlement("write-other");
      } else if (invalidated.current) {
        confirmed.current = null;
      } else {
        const settled = result.kind === "added" ? (result.adopted ?? null) : null;
        const settledKey = sceneAudioInputKey(settled, h.sceneSelection());
        setPlan(null);
        setSelectedLanes([]);
        setMessage(result.message);
        noteSceneSettlement(
          result.message.includes("声音已加入并保存") ? "write-success" : "write-other",
        );
        confirmed.current =
          settled && settledKey !== null && settledKey !== capturedKey ? settled : null;
      }
    } catch {
      confirmed.current = null;
      if (JSON.stringify(hostRef.current.sceneSelection()) === applyScope) {
        const text = "本次声音保存结果还需核对，请查看本地素材保存状态。";
        unsettled.current = text;
        setMessage(text);
      }
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }
  async function remove(id: string) {
    const h = hostRef.current,
      base = h.current();
    if (!base || controllerRef.current.busy) return;
    await controllerRef.current.runGroupOperation(base.id, () => removeSceneAudioGroup(h, id));
  }
  return {
    tools: (
      <>
        <button
          className="btn sm"
          disabled={!enabled || !key || controller.busy}
          onClick={() => {
            setOpen(true);
            void read();
          }}
        >
          查看本场声音建议
        </button>
        {film?.audioClips.some((clip) => soundRowLabel(clip) === UNGENERATED_SOUND_LABEL) ? (
          <p className="role-desc">{UNGENERATED_SOUND_LABEL}</p>
        ) : null}
        {enabled && !key && (
          <p className="role-desc">
            全片已选视频或当前场次尚不完整，请先核对后再查看整场声音建议。
          </p>
        )}
        <AudioSuggestionGroups
          scene
          groups={groups}
          busy={controller.busy || (!!film && controller.pendingFor(film.id))}
          onRemove={(id) => void remove(id)}
        />
      </>
    ),
    dialog: open && (
      <ShotAudioSuggestionDialog
        sceneMode
        plan={plan}
        busy={busy}
        message={message}
        canApply={typeof window.aijian?.applyBundledFilmSceneAudio === "function"}
        applying={applying}
        selectedLanes={selectedLanes}
        existingClips={film?.audioClips.length ?? 0}
        onLanes={setSelectedLanes}
        onApply={() => void apply()}
        onRefresh={() => void read()}
        onClose={() => {
          dropSettlement();
          generation.current++;
          setOpen(false);
          setBusy(false);
          setPlan(null);
          setMessage("");
        }}
      />
    ),
  };
}
