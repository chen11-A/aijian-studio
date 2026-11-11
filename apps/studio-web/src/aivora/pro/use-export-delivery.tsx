import { useEffect, useRef, useState } from "react";
import type { FilmExportQcPublishResult } from "@aijian/contracts/film-export-qc";
import { writtenFileName } from "./export-file-name";
import { DeliveryEvidence } from "./DeliveryEvidence";
import { deliveryEvidenceView, type DeliveryEvidenceView } from "./actions/delivery-evidence-view";
type Published = { projectId: string; path: string; partial: boolean; view: DeliveryEvidenceView };
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
    const value: Published = {
      projectId: id,
      path: typeof result.outputs[0]?.path === "string" ? result.outputs[0].path : "",
      partial: result.kind === "PARTIAL",
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
    writtenName: shown?.path ? writtenFileName(shown.path) : "",
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
