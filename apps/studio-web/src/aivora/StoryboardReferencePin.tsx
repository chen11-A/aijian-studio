import { useEffect, useRef, useState } from "react";
import type { createStudioTransport } from "../api/studio";
import { Button } from "./Common";
import { sameStoryboardJson, type StoryboardContent } from "./adapters/episodeStoryboard";
import {
  hasReferences,
  referenceImpact,
  referencePin,
  validReferenceVersion,
  withReferencePin,
  type ReferenceKind,
  type ReferenceVersion,
} from "./storyboardReferenceImpact";

type Inspection = {
  scope: string;
  state: "loading" | "error" | "ready";
  version: ReferenceVersion | null;
};
/** Inspection is read-only. Only an explicit upgrade updates the draft's exact pin. */
export function StoryboardReferencePin({
  kind,
  content,
  version,
  sourceLabel,
  locked,
  transport,
  edit,
}: {
  kind: ReferenceKind;
  content: StoryboardContent;
  version: ReferenceVersion | null;
  sourceLabel: string;
  locked: boolean;
  transport: ReturnType<typeof createStudioTransport>;
  edit: (update: (value: StoryboardContent) => StoryboardContent) => void;
}) {
  const pin = referencePin(kind, content);
  const name = kind === "script" ? "剧本" : "设定";
  const label = kind === "script" ? name : "共享设定";
  const scope = `${content.project_id}/${content.episode_id}/${kind}/${pin ?? ""}`;
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const request = useRef(0);
  useEffect(() => {
    request.current += 1;
    setInspection(null);
    return () => {
      request.current += 1;
    };
  }, [scope]);
  const current =
    version && validReferenceVersion(kind, version, content) && (!pin || version.version_id === pin)
      ? version
      : null;
  const active = inspection?.scope === scope ? inspection : null;
  const target = active?.state === "ready" ? active.version : null;
  const impact = target && current ? referenceImpact(kind, content, current, target) : null;
  const referenced = hasReferences(kind, content);
  const sameScope = (value: StoryboardContent) =>
    value.project_id === content.project_id &&
    value.episode_id === content.episode_id &&
    referencePin(kind, value) === pin;
  function cancel() {
    request.current += 1;
    setInspection(null);
  }
  async function inspect() {
    if (locked || !pin || !current || active?.state === "loading") return;
    const ticket = ++request.current;
    setInspection({ scope, state: "loading", version: null });
    try {
      const result =
        kind === "script"
          ? await transport.getEpisodeScript?.(content.project_id, content.episode_id)
          : await transport.getProjectCreativeLibrary?.(content.project_id);
      if (ticket !== request.current) return;
      const candidate = result?.kind === "FOUND" ? result.receipt.data : null;
      if (
        !validReferenceVersion(kind, candidate, content) ||
        (candidate.version_id === pin
          ? candidate.version_number !== current.version_number ||
            candidate.content_hash !== current.content_hash ||
            !sameStoryboardJson(candidate.content, current.content)
          : candidate.version_number <= current.version_number)
      ) {
        setInspection({ scope, state: "error", version: null });
        return;
      }
      setInspection({ scope, state: "ready", version: candidate });
    } catch {
      if (ticket === request.current) setInspection({ scope, state: "error", version: null });
    }
  }
  function changePin() {
    if (locked) return;
    if (pin) {
      if (
        referenced ||
        !window.confirm(`本集已没有${name}条目引用。解除当前${name}版本关联？镜头内容保留。`)
      )
        return;
      edit((value) =>
        sameScope(value) && !hasReferences(kind, value)
          ? withReferencePin(kind, value, null)
          : value,
      );
    } else if (current) {
      edit((value) =>
        sameScope(value) && validReferenceVersion(kind, current, value)
          ? withReferencePin(kind, value, current.version_id)
          : value,
      );
    }
  }
  function upgrade() {
    if (
      locked ||
      !pin ||
      !target ||
      !current ||
      !impact ||
      impact.missing.length ||
      target.version_id === pin
    )
      return;
    edit((value) =>
      sameScope(value) &&
      validReferenceVersion(kind, target, value) &&
      !referenceImpact(kind, value, current, target).missing.length
        ? withReferencePin(kind, value, target.version_id)
        : value,
    );
    cancel();
  }
  return (
    <>
      <div className="storyboard-pin-row">
        <span>
          {pin
            ? `已固定${label} v${current?.version_number ?? "?"} · ${pin.slice(-8)}`
            : current
              ? `可关联${label} v${current.version_number}`
              : sourceLabel}
        </span>
        <Button disabled={locked || (pin ? referenced : !current)} onClick={changePin}>
          {pin ? `解除${name}关联` : `关联此${name}版本`}
        </Button>
        {pin && (
          <Button
            disabled={locked || !current || active?.state === "loading"}
            onClick={() => void inspect()}
          >
            检查最新{name}版本
          </Button>
        )}
      </div>
      {pin && referenced && (
        <small>本集仍有{name}条目引用；如需解除关联，请先逐个镜头调整引用。</small>
      )}
      {active && (
        <section aria-label={`${name}版本升级影响`} aria-live="polite">
          {active.state === "loading" && (
            <p>正在核对最新版本；当前固定版本和全部镜头引用保持不变。</p>
          )}
          {active.state === "error" && (
            <p>无法核对最新版本，当前固定版本及全部引用已保留。请重试检查。</p>
          )}
          {target &&
            impact &&
            (target.version_id === pin ? (
              <p>当前已固定检查时的最新版本，无需升级。</p>
            ) : (
              <>
                <p>
                  检查到{name} v{target.version_number} · {target.version_id}。当前仍固定 v
                  {current?.version_number}。
                </p>
                <p>
                  本集使用此类引用：{impact.referencedShots} 个镜头；引用内容变化：
                  {impact.changed.length} 个镜头。
                </p>
                {impact.changed.length > 0 && (
                  <details>
                    <summary>查看引用内容有变化的镜头</summary>
                    <ul>
                      {impact.changed.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {impact.worldChanged && (
                  <p>世界设定也有变化，请复核本集全部 {content.shots.length} 个镜头。</p>
                )}
                {impact.missing.length > 0 ? (
                  <>
                    <p>
                      目标版本缺少以下引用，升级已阻止。请保留当前版本，逐个镜头重新选择或移除相关引用后再检查。
                    </p>
                    <ul>
                      {impact.missing.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>
                    全部现有引用 ID 在目标版本中仍存在。升级会保留所有镜头文字、时长和引用
                    ID；内容含义仍需人工复核。
                  </p>
                )}
                <Button disabled={locked || impact.missing.length > 0} onClick={upgrade}>
                  将{name}引用升级到 v{target.version_number}
                </Button>
              </>
            ))}
          <Button onClick={cancel}>保留当前{name}版本</Button>
        </section>
      )}
    </>
  );
}
