import { useEffect, useRef, useState } from "react";
import type { FilmProject } from "../film/project";
import { ShotAudioSuggestionDialog } from "./ShotAudioSuggestionDialog";
import {
  readShotAudioSuggestions,
  shotAudioInputKey,
  type ShotAudioPlan,
  type ShotAudioReadHost,
} from "./actions/shot-audio-suggestions";
export function useShotAudioSuggestions(
  film: FilmProject | null,
  enabled: boolean,
  host: ShotAudioReadHost,
) {
  const hostRef = useRef(host);
  hostRef.current = host;
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
      if (result.kind === "ready") setPlan(result.plan);
      else
        setMessage(
          result.kind === "stale" ? "镜头内容或素材已变化，请刷新后重新核对。" : result.message,
        );
    } finally {
      working.current = false;
      if (generation.current === token) setBusy(false);
    }
  }
  return {
    tools: (
      <button
        className="btn sm"
        disabled={!enabled || !key}
        onClick={() => {
          setOpen(true);
          void read();
        }}
      >
        查看本镜声音建议
      </button>
    ),
    dialog: open && (
      <ShotAudioSuggestionDialog
        plan={plan}
        busy={busy}
        message={message}
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
