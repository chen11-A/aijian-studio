import { useEffect, useRef, useState } from "react";
import type { FilmProject } from "../film/project";
import { AudioSuggestionGroups, type AudioGroupView } from "./AudioSuggestionGroups";
import { verifiedAudioGroup } from "./actions/audio-suggestion-proof";
import { applyShotAudioGroup, removeShotAudioGroup } from "./actions/shot-audio-apply";
import type { LibraryHost, LibraryOutcome } from "./actions/audio-library";
import { ShotAudioSuggestionDialog } from "./ShotAudioSuggestionDialog";
import {
  readShotAudioSuggestions,
  shotAudioInputKey,
  type ShotAudioPlan,
} from "./actions/shot-audio-suggestions";
export function useShotAudioSuggestions(
  film: FilmProject | null,
  enabled: boolean,
  host: LibraryHost,
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
  const generation = useRef(0),
    working = useRef(false);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ShotAudioPlan | null>(null),
    [message, setMessage] = useState("");
  const selection = host.selection(),
    scope = JSON.stringify(selection),
    key = shotAudioInputKey(film, selection);
  const previous = useRef({ scope, key, enabled });
  useEffect(() => {
    const last = previous.current;
    previous.current = { scope, key, enabled };
    if (last.scope === scope && last.key === key && last.enabled === enabled) return;
    generation.current++;
    setPlan(null);
    setBusy(false);
    if (last.scope !== scope || !enabled) {
      setOpen(false);
      setMessage("");
    } else setMessage("镜头内容或素材已变化，请刷新后重新核对。");
  }, [scope, key, enabled]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function read() {
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
      const result = await readShotAudioSuggestions(
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
          result.kind === "stale" ? "镜头内容或素材已变化，请刷新后重新核对。" : result.message,
        );
    } finally {
      working.current = false;
      if (generation.current === token) setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    const selected = hostRef.current.selection();
    const candidates =
      film?.audioClips.filter(
        (c) =>
          c.shotId === selected?.shotId &&
          c.takeId === selected?.takeId &&
          c.suggestionGroup &&
          !c.sceneAudioBinding,
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
        const clips = candidates.filter((c) => c.suggestionGroup!.groupId === id),
          receipt = await verifiedAudioGroup(film!.audioClips, id);
        return {
          id,
          count: clips.length,
          complete: !!receipt && receipt.memberCount === clips.length,
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
      token = generation.current;
    if (!base || !captured || applyingRef.current || controllerRef.current.busy || working.current)
      return;
    applyingRef.current = true;
    setApplying(true);
    setMessage("");
    try {
      const result = await controllerRef.current.runGroupOperation(base.id, () =>
        applyShotAudioGroup(h, captured, planKey.current, selectedLanes),
      );
      if (generation.current === token) {
        setPlan(null);
        setSelectedLanes([]);
        setMessage(result.message);
      }
    } catch {
      if (generation.current === token)
        setMessage("本次声音保存结果还需核对，请查看本地素材保存状态。");
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }
  async function remove(id: string) {
    const h = hostRef.current,
      base = h.current();
    if (!base || controllerRef.current.busy) return;
    await controllerRef.current.runGroupOperation(base.id, () => removeShotAudioGroup(h, base, id));
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
          查看本镜声音建议
        </button>
        <p className="role-desc">建议 · 未生成</p>
        <AudioSuggestionGroups
          groups={groups}
          busy={controller.busy || (!!film && controller.pendingFor(film.id))}
          onRemove={(id) => void remove(id)}
        />
      </>
    ),
    dialog: open && (
      <ShotAudioSuggestionDialog
        plan={plan}
        busy={busy}
        message={message}
        canApply={typeof window.aijian?.applyBundledFilmShotAudio === "function"}
        applying={applying}
        selectedLanes={selectedLanes}
        existingClips={film?.audioClips.length ?? 0}
        onLanes={setSelectedLanes}
        onApply={() => void apply()}
        onRefresh={() => void read()}
        onClose={() => {
          generation.current++;
          setOpen(false);
          setBusy(false);
          setPlan(null);
        }}
      />
    ),
  };
}
