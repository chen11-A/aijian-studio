import type { DraftExportGateway, DraftExportJob } from "./adapters/draftExport";

export type PreviewState =
  { kind: "idle" | "loading" } | { kind: "ready"; url: string } | { kind: "error"; notice: string };
export type RevealState =
  { kind: "idle" | "loading" } | { kind: "ready" | "error"; notice: string };

export type DraftExportOutputProps = {
  projectId: string;
  episodeId: string;
  job: DraftExportJob;
  gateway:
    | (Pick<DraftExportGateway, "preview" | "reveal" | "review" | "revision"> &
        Partial<Pick<DraftExportGateway, "list" | "get">>)
    | undefined;
  showReview?: boolean;
  reviewExpanded?: boolean;
  revisionExpanded?: boolean;
  onAssembly?: () => void;
  onExport?: () => void;
};

export function revisionExportGateway(gateway: DraftExportOutputProps["gateway"]) {
  return gateway?.list && gateway.get
    ? { list: gateway.list, get: gateway.get, preview: gateway.preview, reveal: gateway.reveal }
    : undefined;
}

export function draftOutputKey({ projectId, episodeId, job }: DraftExportOutputProps) {
  return JSON.stringify([
    projectId,
    episodeId,
    job.operation_id,
    job.assembly_version_id,
    job.assembly_content_hash,
    job.output_sha256,
    job.output_bytes,
    job.output_path,
  ]);
}
