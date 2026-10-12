import { useMemo, useRef, useState } from "react";
import { visualReadData, visualJson, type VisualRead } from "@aijian/contracts/visual-bible";
import { validCreativeVersion, type CreativeVersion } from "./adapters/creativeLibrary";
import { visualBrowserHash } from "./visualWorkspace";

/** Reopen immutable cause versions; original loss must not rewrite historic impact. */
export function VisualApprovalCauseInspector({
  projectId,
  artifactId,
  oldVersionId,
  newVersionId,
}: {
  projectId: string;
  artifactId: string;
  oldVersionId: string;
  newVersionId: string;
}) {
  const identity = useMemo(
    () => ({ projectId, artifactId, oldVersionId, newVersionId }),
    [projectId, artifactId, oldVersionId, newVersionId],
  );
  const active = useRef(identity);
  active.current = identity;
  const sequence = useRef(0);
  const [result, setResult] = useState<{
    identity: typeof identity;
    old: VisualRead;
    next: VisualRead;
    oldLibrary: CreativeVersion;
    nextLibrary: CreativeVersion;
  } | null>(null);
  const [status, setStatus] = useState<{ identity: typeof identity; message: string } | null>(null);
  async function inspect() {
    const request = ++sequence.current;
    setStatus({ identity, message: "正在核对报告引用的精确视觉原因版本…" });
    try {
      const g = window.aijian;
      async function source(versionId: string) {
        const v = await g?.getVisualBibleVersion?.(projectId, versionId);
        if (
          v?.kind !== "FOUND" ||
          !visualReadData(v.data, projectId) ||
          v.data.version.id !== versionId ||
          v.data.version.artifact_id !== artifactId ||
          (await visualBrowserHash(v.data.version.content)) !== v.data.version.content_hash
        )
          throw new Error("Visual cause unavailable");
        const library = await g?.getProjectCreativeLibraryVersion?.(
          projectId,
          v.data.version.content.creative_library_version_id,
        );
        if (
          library?.kind !== "FOUND" ||
          !validCreativeVersion(library.receipt.data, projectId) ||
          library.receipt.data.version_id !== v.data.version.content.creative_library_version_id ||
          library.receipt.data.content_hash !==
            v.data.version.content.creative_library_content_hash ||
          (await visualBrowserHash(library.receipt.data.content)) !==
            library.receipt.data.content_hash
        )
          throw new Error("Pinned cause library unavailable");
        return { visual: v.data, library: library.receipt.data };
      }
      const [old, next] = await Promise.all([source(oldVersionId), source(newVersionId)]);
      if (active.current !== identity || sequence.current !== request) return;
      setResult({
        identity,
        old: old.visual,
        next: next.visual,
        oldLibrary: old.library,
        nextLibrary: next.library,
      });
      setStatus(null);
    } catch {
      if (active.current === identity && sequence.current === request)
        setStatus({
          identity,
          message:
            "尚未可靠读到此报告的视觉原因版本，不能据此认定没有环境影响。其他Gate的原依赖报告仍可读，原选择保留。",
        });
    }
  }
  const saved = result?.identity === identity ? result : null;
  const states = (v: VisualRead) =>
    v.version.content.schema_version === "1.1.0"
      ? v.version.content.environment_scope.scene_variant_ids.join("、") || "明确空范围"
      : "旧范围未审查独立状态";
  const refs = (v: VisualRead) =>
    v.version.content.schema_version === "1.1.0"
      ? v.version.content.environment_scope.environment_reference_ids.join("、") || "明确空范围"
      : "旧范围未审查独立参考";
  return (
    <section aria-label="精确视觉环境替代原因">
      <button type="button" onClick={() => void inspect()}>
        核对此报告是否为视觉环境替代原因
      </button>
      {status?.identity === identity && <p role="status">{status.message}</p>}
      {saved && (
        <>
          <p>新批准版本的共享改动原因：{saved.next.version.content.change_reason}</p>
          <p>
            精确库版本：{saved.oldLibrary.version_id} → {saved.nextLibrary.version_id}
          </p>
          <p>
            世界文本：
            {visualJson(saved.oldLibrary.content.world) ===
            visualJson(saved.nextLibrary.content.world)
              ? "两版相同"
              : "发生变化，请核对两版原文"}
          </p>
          <p>
            状态审查范围：{states(saved.old)} → {states(saved.next)}
          </p>
          <p>
            原件参考范围：{refs(saved.old)} → {refs(saved.next)}
          </p>
          <details>
            <summary>查看原批准与新批准的完整不可变依据</summary>
            <pre>
              {JSON.stringify(
                {
                  old: { visual: saved.old.version, library: saved.oldLibrary },
                  next: { visual: saved.next.version, library: saved.nextLibrary },
                },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
