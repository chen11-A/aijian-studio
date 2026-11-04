import { useEffect, useState } from "react";
import { visualAuthorityData, type VisualAuthority } from "@aijian/contracts/visual-bible";

/** Read the exact pin; never substitute the currently accepted visual version. */
export function useVisualAuthority(projectId: string, versionId?: string, contentHash?: string) {
  const key = `${projectId}/${versionId ?? ""}/${contentHash ?? ""}`;
  const [snapshot, setSnapshot] = useState<{ key: string; value: VisualAuthority | null }>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      let value: VisualAuthority | null = null;
      try {
        if (versionId && contentHash) {
          const result = await window.aijian?.getVisualBibleAuthority?.(projectId, versionId);
          if (
            result?.kind === "FOUND" &&
            visualAuthorityData(result.data, projectId, versionId) &&
            result.data.content_hash === contentHash
          )
            value = result.data;
        }
      } catch {
        /* An unavailable receipt cannot erase or retarget an existing pin. */
      }
      if (active) setSnapshot({ key, value });
    })();
    return () => {
      active = false;
    };
  }, [projectId, versionId, contentHash, key, refresh]);
  return {
    authority: snapshot?.key === key ? snapshot.value : null,
    settled: snapshot?.key === key,
    refresh: () => setRefresh((v) => v + 1),
  };
}
export const visualAuthorityLabel = (value: VisualAuthority | null) =>
  value
    ? {
        CURRENT: "当前批准证据有效",
        SUPERSEDED: "批准版本已被替代",
        EVIDENCE_CHANGED: "原文件、授权或检查证据已变化",
        UNAPPROVED: "缺少完整G5批准",
        UNAVAILABLE: "批准证据不可用",
      }[value.status]
    : "批准状态尚未可靠核对";
