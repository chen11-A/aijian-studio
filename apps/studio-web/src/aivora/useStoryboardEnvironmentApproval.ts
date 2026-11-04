import { useEffect, useMemo, useRef, useState } from "react";
import {
  visualReadData,
  visualAuthorityData,
  type VisualContent,
} from "@aijian/contracts/visual-bible";
import type { StoryboardContent } from "./adapters/episodeStoryboard";
import type { CreativeVersion } from "./adapters/creativeLibrary";
import { visualBrowserHash } from "./visualWorkspace";

export function useStoryboardEnvironmentApproval(
  content: StoryboardContent,
  library: CreativeVersion | null,
) {
  const pin = content.schema_version === "1.5.0" ? content.visual_bible_pin : null;
  const [revision, refresh] = useState(0);
  const identity = useMemo(
    () => ({
      project: content.project_id,
      episode: content.episode_id,
      version: pin?.version_id,
      hash: pin?.content_hash,
      library: library?.version_id,
      libraryHash: library?.content_hash,
      revision,
    }),
    [
      content.project_id,
      content.episode_id,
      pin?.version_id,
      pin?.content_hash,
      library?.version_id,
      library?.content_hash,
      revision,
    ],
  );
  const current = useRef(identity);
  current.current = identity;
  const [read, setRead] = useState<{ identity: typeof identity; content: VisualContent } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    if (!pin || !library || library.version_id !== content.creative_library_version_id) return;
    void (async () => {
      try {
        const g = window.aijian;
        const [v, a] = await Promise.all([
          g?.getVisualBibleVersion?.(identity.project, pin.version_id),
          g?.getVisualBibleAuthority?.(identity.project, pin.version_id),
        ]);
        if (
          !live ||
          current.current !== identity ||
          v?.kind !== "FOUND" ||
          !visualReadData(v.data, identity.project) ||
          v.data.version.id !== pin.version_id ||
          v.data.version.content_hash !== pin.content_hash ||
          (await visualBrowserHash(v.data.version.content)) !== pin.content_hash ||
          a?.kind !== "FOUND" ||
          !visualAuthorityData(a.data, identity.project, pin.version_id) ||
          a.data.status !== "CURRENT" ||
          a.data.content_hash !== pin.content_hash ||
          v.data.version.content.schema_version !== "1.1.0" ||
          v.data.version.content.creative_library_version_id !== library.version_id ||
          v.data.version.content.creative_library_content_hash !== library.content_hash ||
          (await visualBrowserHash(library.content)) !== library.content_hash ||
          !live ||
          current.current !== identity
        )
          return;
        setRead({ identity, content: v.data.version.content });
      } catch {
        /* Preserve exact selections and pin on an unknown read. */
      }
    })();
    return () => {
      live = false;
    };
  }, [identity]);
  const visual = read?.identity === identity ? read.content : null;
  return {
    scope: visual?.schema_version === "1.1.0" ? visual.environment_scope : null,
    refresh: () => refresh((v) => v + 1),
  };
}
