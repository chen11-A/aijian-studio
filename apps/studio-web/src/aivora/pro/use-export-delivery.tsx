import { useEffect, useRef, useState } from "react";
import type { FilmExportQcPublishResult } from "@aijian/contracts/film-export-qc";
import { writtenExportNames } from "./export-file-name";
import { DeliveryEvidence } from "./DeliveryEvidence";
import { partialAspectNotice } from "./actions/export-qc";
import { deliveryEvidenceView, type DeliveryEvidenceView } from "./actions/delivery-evidence-view";
type Published = {
  projectId: string;
  path: string;
  names: string;
  partial: boolean;
  partialNotice: string;
  view: DeliveryEvidenceView;
};
export function useExportDelivery(projectId: string | null, currentProject: () => string | null) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = null;
    };
  }, []);
  const current = useRef(currentProject);
  current.current = currentProject;
  const active = useRef<Published | null>(null);
  const [published, setPublished] = useState<Published | null>(null);
  function clear() {
    active.current = null;
    if (mounted.current) setPublished(null);
  }
  function remember(
    id: string,
    result: Extract<FilmExportQcPublishResult, { kind: "PUBLISHED" | "PARTIAL" }>,
  ) {
    if (!mounted.current || current.current() !== id) return;
    const paths = result.outputs.flatMap((output) =>
      typeof output.path === "string" && output.path ? [output.path] : [],
    );
    const value: Published = {
      projectId: id,
      path: paths[0] ?? "",
      names: writtenExportNames(paths),
      partial: result.kind === "PARTIAL",
      partialNotice:
        result.kind === "PARTIAL" && result.incomplete
          ? partialAspectNotice(result.incomplete)
          : "",
      view: deliveryEvidenceView(result.deliveryEvidence, result.kind),
    };
    active.current = value;
    setPublished(value);
  }
  const shown = published?.projectId === projectId ? published : null;
  function path() {
    return mounted.current &&
      shown &&
      active.current === shown &&
      current.current() === shown.projectId
      ? shown.path
      : "";
  }
  return {
    clear,
    remember,
    available: !!shown?.path,
    writtenName: shown?.names ?? "",
    partialNotice: shown?.partialNotice ?? "",
    view: shown ? <DeliveryEvidence view={shown.view} partial={shown.partial} /> : null,
    onReveal: () => {
      const value = path();
      if (value) void window.aijian?.revealFilmPath?.(value);
    },
    onOpen: () => {
      const value = path();
      if (value) void window.aijian?.openFilmPath?.(value);
    },
  };
}
