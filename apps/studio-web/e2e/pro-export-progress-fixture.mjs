/** Extends the canonical QC fixture inside the page. Only synthetic events and ACKs. */
export function installExportProgressBridge({ state, aspect }) {
  const bridge = window.aijian;
  const listeners = new Set();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const audit = {
    prepare: [],
    publish: [],
    cancel: [],
    played: [],
    events: [],
    current: null,
    seq: 0,
  };
  window.__exportProgressAudit = audit;
  audit.emit = (patch = {}, deliver = true) => {
    if (!audit.current) throw new Error("No synthetic export operation");
    const event = {
      operationId: audit.current.operationId,
      projectId: audit.current.input.projectId,
      seq: ++audit.seq,
      phase: "rendering",
      cancelState: "available",
      published: [],
      ...patch,
    };
    audit.events.push(clone(event));
    if (deliver) for (const listener of listeners) listener(event);
    return event;
  };
  bridge.onFilmExportProgress = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const basePrepare = bridge.prepareFilmExport;
  bridge.prepareFilmExport = async (input, operationId) => {
    if (!operationId) throw new Error("Missing export operation identity");
    audit.prepare.push({ input: clone(input), operationId });
    audit.current = { input: clone(input), operationId };
    audit.seq = 0;
    return new Promise((resolve) => {
      audit.finishPrepare = async (kind = "READY") => {
        const result =
          kind === "READY"
            ? await basePrepare(input)
            : { kind: "FAILED", code: "OPERATION_STOPPED" };
        audit.emit({
          phase: kind === "READY" ? "waitingReview" : "failed",
          cancelState: kind === "READY" ? "unavailable" : "stopped",
        });
        resolve(result);
      };
    });
  };
  bridge.publishFilmExport = async (input, operationId) => {
    if (!operationId) throw new Error("Missing publish operation identity");
    audit.publish.push({ input: clone(input), operationId });
    audit.current = { input: clone(input), operationId };
    audit.seq = 0;
    return new Promise((resolve) => {
      audit.finishPublish = () =>
        resolve({
          kind: "PARTIAL",
          outputs: [{ aspectRatio: aspect, path: "/synthetic/published-part.mp4" }],
        });
    });
  };
  bridge.cancelFilmExportOperation = async (operationId) => {
    audit.cancel.push(operationId);
    if (state === "unavailable-retry" && audit.cancel.length === 1) {
      const snapshot = audit.emit({ phase: "publishing", cancelState: "unavailable" }, false);
      return { kind: "UNAVAILABLE", snapshot };
    }
    const previous = audit.events.at(-1);
    const snapshot = audit.emit(
      {
        phase: previous?.phase ?? "rendering",
        progress: previous?.progress,
        published: previous?.published ?? [],
        cancelState: "requested",
      },
      false,
    );
    return { kind: "REQUESTED", snapshot };
  };
  bridge.openFilmPath = async (value) => {
    audit.played.push(value);
  };
  bridge.revealFilmPath = async () => {
    window.__exportQcAudit.forbidden.push("reveal");
    throw new Error("Unexpected reveal in audit");
  };
}
