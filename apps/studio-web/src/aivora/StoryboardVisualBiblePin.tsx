import { useEffect, useRef, useState } from "react";
import {
  visualIndexData,
  visualReadData,
  visualAuthorityData,
  visualEnvironmentChoicesWithinScope,
  type VisualRead,
} from "@aijian/contracts/visual-bible";
import { Button } from "./Common";
import { validCreativeVersion, type CreativeVersion } from "./adapters/creativeLibrary";
import {
  withStoryboardVisualBasis,
  hasStoryboardEnvironmentChoices,
  type StoryboardContent,
} from "./adapters/episodeStoryboard";
import { referenceImpact, hasReferences } from "./storyboardReferenceImpact";
import { visualBrowserHash } from "./visualWorkspace";
import { useVisualAuthority, visualAuthorityLabel } from "./useVisualAuthority";

export function StoryboardVisualBiblePin({
  content,
  library,
  locked,
  edit,
}: {
  content: StoryboardContent;
  library: CreativeVersion | null;
  locked: boolean;
  edit: (update: (v: StoryboardContent) => StoryboardContent) => void;
}) {
  const pin = "visual_bible_pin" in content ? content.visual_bible_pin : null;
  const scope = `${content.project_id}/${content.episode_id}/${pin?.version_id ?? ""}/${content.creative_library_version_id ?? ""}`;
  const { authority, refresh } = useVisualAuthority(
    content.project_id,
    pin?.version_id,
    pin?.content_hash,
  );
  const [candidate, setCandidate] = useState<{
    scope: string;
    visual: VisualRead;
    library: CreativeVersion;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setCandidate(null);
    setMessage("");
    setBusy(false);
    return () => {
      epoch.current++;
    };
  }, [scope]);
  const target = candidate?.scope === scope ? candidate : null;
  const impact =
    target && library ? referenceImpact("library", content, library, target.library) : null;
  const missing = impact?.missing ?? [];
  const unknownSource = hasReferences("library", content) && !library;
  const unapprovedEnvironment = target
    ? !visualEnvironmentChoicesWithinScope(content, target.visual.version.content)
    : hasStoryboardEnvironmentChoices(content);
  const sameScope = (v: StoryboardContent) =>
    v.project_id === content.project_id &&
    v.episode_id === content.episode_id &&
    v.creative_library_version_id === content.creative_library_version_id &&
    ("visual_bible_pin" in v ? v.visual_bible_pin?.version_id : undefined) === pin?.version_id;
  async function inspect() {
    if (locked || busy) return;
    const operation = ++epoch.current;
    setBusy(true);
    setCandidate(null);
    setMessage("");
    refresh();
    try {
      const g = window.aijian;
      const idx = await g?.getVisualBible?.(content.project_id);
      if (
        idx?.kind !== "FOUND" ||
        !visualIndexData(idx.data, content.project_id) ||
        !idx.data.accepted_version
      )
        throw new Error("No approved visual version");
      const id = idx.data.accepted_version.id;
      const [read, state] = await Promise.all([
        g?.getVisualBibleVersion?.(content.project_id, id),
        g?.getVisualBibleAuthority?.(content.project_id, id),
      ]);
      if (
        read?.kind !== "FOUND" ||
        !visualReadData(read.data, content.project_id) ||
        read.data.version.id !== id ||
        state?.kind !== "FOUND" ||
        !visualAuthorityData(state.data, content.project_id, id) ||
        state.data.status !== "CURRENT" ||
        state.data.content_hash !== read.data.version.content_hash ||
        (await visualBrowserHash(read.data.version.content)) !== read.data.version.content_hash
      )
        throw new Error("Approval unavailable");
      const basis = await g?.getProjectCreativeLibraryVersion?.(
        content.project_id,
        read.data.version.content.creative_library_version_id,
      );
      if (
        basis?.kind !== "FOUND" ||
        !validCreativeVersion(basis.receipt.data, content.project_id) ||
        basis.receipt.data.version_id !== read.data.version.content.creative_library_version_id ||
        (await visualBrowserHash(basis.receipt.data.content)) !== basis.receipt.data.content_hash ||
        basis.receipt.data.content_hash !== read.data.version.content.creative_library_content_hash
      )
        throw new Error("Library pin unavailable");
      if (operation === epoch.current)
        setCandidate({ scope, visual: read.data, library: basis.receipt.data });
    } catch {
      if (operation === epoch.current)
        setMessage("当前批准版本未通过核对；原引用和未保存输入保留。");
    } finally {
      if (operation === epoch.current) setBusy(false);
    }
  }
  function bind() {
    if (
      locked ||
      unapprovedEnvironment ||
      !target ||
      unknownSource ||
      missing.length ||
      !window.confirm(
        `固定视觉版本 v${target.visual.version.version_number} 和其共享设定版本？全体 ${content.shots.length} 个镜头文字、时长和原选用保留；仍须逐镜选择批准范围内的角色/服装参考，保存时重新核对批准证据。`,
      )
    )
      return;
    edit((v) =>
      sameScope(v) &&
      visualEnvironmentChoicesWithinScope(v, target.visual.version.content) &&
      (!library || !referenceImpact("library", v, library, target.library).missing.length)
        ? withStoryboardVisualBasis(
            v,
            target.library.version_id,
            {
              version_id: target.visual.version.id,
              content_hash: target.visual.version.content_hash,
            },
            target.visual.version.content.schema_version === "1.1.0",
          )
        : v,
    );
  }
  return (
    <section aria-label="视觉版本引用">
      <h4>视觉版本</h4>
      {pin ? (
        <>
          <p>
            固定版本 {pin.version_id} · {pin.content_hash.slice(0, 12)} ·{" "}
            {visualAuthorityLabel(authority)}
          </p>
          <p>批准证据变化或版本替代会阻止新的分镜保存、装配保存和草稿导出；历史内容保留。</p>
        </>
      ) : (
        <p>尚未固定视觉版本。手工分镜可继续保存，不表示已完成视觉审签。</p>
      )}
      <Button disabled={locked || busy} onClick={() => void inspect()}>
        检查当前批准的视觉版本
      </Button>
      {message && <p role="status">{message}</p>}
      {unapprovedEnvironment && (
        <p>此草稿含独立环境状态/参考，现有视觉约定未覆盖，不能将它们视为已批准或自动清空后改绑。</p>
      )}
      {target && (
        <>
          <p>
            核对到视觉 v{target.visual.version.version_number} · {target.visual.version.id}
            ，关联设定 {target.library.version_id}。
          </p>
          <p>
            本集 {content.shots.length} 个镜头；引用内容变化 {impact?.changed.length ?? 0} 个镜头。
            {impact?.worldChanged ? "世界设定变化，需要复核全部镜头。" : ""}
          </p>
          {impact?.changed.map((item) => (
            <p key={item}>{item}</p>
          ))}
          {missing.map((item) => (
            <p key={item}>{item}</p>
          ))}
          {unknownSource && <p>现有设定引用尚未可靠读回，暂不能改绑。</p>}
          <Button
            disabled={
              locked ||
              unapprovedEnvironment ||
              unknownSource ||
              missing.length > 0 ||
              pin?.version_id === target.visual.version.id
            }
            onClick={bind}
          >
            固定此批准视觉和设定版本
          </Button>
        </>
      )}
      {pin && (
        <Button
          disabled={locked}
          onClick={() => {
            if (
              !locked &&
              window.confirm(
                "解除当前草稿的视觉版本引用？镜头选用和历史版本保留；此草稿不再声明固定视觉批准。",
              )
            )
              edit((v) =>
                sameScope(v) && "visual_bible_pin" in v ? { ...v, visual_bible_pin: null } : v,
              );
          }}
        >
          解除视觉版本引用
        </Button>
      )}
    </section>
  );
}
