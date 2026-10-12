import { createHash, webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import type {
  AssemblyReadinessData,
  AssemblyReadinessResult,
} from "@aijian/contracts/assembly-readiness";
import { AssemblyReadinessPanel } from "./AssemblyReadinessPanel";
import type { EpisodeMediaAssemblyGateway } from "./adapters/episodeMediaAssembly";
import f from "../../../../packages/contracts/fixtures/manual-media-candidate.json";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
function result(
  project = f.project_id,
  episode = f.episode_id,
): AssemblyReadinessResult & { kind: "FOUND" } {
  const assembly = structuredClone(
    f.assembly_operation.version,
  ) as AssemblyReadinessData["assembly"];
  assembly.content.project_id = project;
  assembly.content.episode_id = episode;
  assembly.content_hash = `sha256:${createHash("sha256").update(impactCanonical(assembly.content)).digest("hex")}`;
  return {
    kind: "FOUND",
    receipt: {
      request_id: f.request_id,
      data: {
        assembly,
        is_current_head: true,
        source_checks: [
          { scope: "SCRIPT", status: "NOT_BOUND", code: "SCRIPT_NOT_CONFIRMED" },
          { scope: "STORYBOARD", status: "BLOCKED", code: "STORYBOARD_NOT_APPROVED" },
        ],
        blockers: [
          { code: "PICTURE_LOCK_MISSING", scope: "PICTURE_LOCK", message: "缺少明确画面锁定" },
        ],
        checked_at: "2026-10-11T12:00:00Z",
        picture_lock_status: "NO_PICTURE_LOCK",
        export_status: "NO_EXPORT_CLAIM",
        formal_status: "BLOCKED",
      },
    },
  };
}
function setup(r = result()) {
  const get = vi.fn().mockResolvedValue(r);
  const { assembly } = r.receipt.data;
  const target = { version_id: assembly.version_id, content_hash: assembly.content_hash };
  const props = {
    projectId: assembly.content.project_id,
    episodeId: assembly.content.episode_id,
    target,
    gateway: { getEpisodeAssemblyReadiness: get },
  };
  return { r, get, props, view: render(<AssemblyReadinessPanel {...props} />) };
}
function check() {
  fireEvent.click(screen.getByRole("button", { name: "只读核对前置证据", hidden: true }));
}
describe("saved assembly prerequisite read in actual production panel", () => {
  it("shows one exact saved read, actual pins and blockers, keeping dirty/unknown-write protection", async () => {
    const s = setup();
    s.view.rerender(<AssemblyReadinessPanel {...s.props} dirty pending />);
    check();
    await screen.findByText(/正式输出阻断/);
    expect(s.get).toHaveBeenCalledWith(s.props.projectId, s.props.episodeId, s.props.target);
    expect(screen.getByText(/本次只核对已保存版本/)).toBeInTheDocument();
    expect(screen.getByText(/不解除原写入保护/)).toBeInTheDocument();
    expect(screen.getByText(/缺少明确画面锁定/)).toBeInTheDocument();
    expect(screen.getByText(/原件 字节已核实/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /批准|保存|编码|导出成片/, hidden: true }),
    ).not.toBeInTheDocument();
    expect(s.get).toHaveBeenCalledOnce();
  });
  it("loads the export entry's latest saved version without cancelling its own initial read", async () => {
    const r = result(),
      readLatest = vi.fn().mockResolvedValue({
        kind: "FOUND",
        receipt: { request_id: f.request_id, data: r.receipt.data.assembly },
      });
    const get = vi.fn().mockResolvedValue(r);
    render(
      <AssemblyReadinessPanel
        projectId={f.project_id}
        episodeId={f.episode_id}
        assembly={{ readLatest } as unknown as EpisodeMediaAssemblyGateway}
        gateway={{ getEpisodeAssemblyReadiness: get }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "只读核对前置证据", hidden: true })).toBeEnabled(),
    );
    check();
    await screen.findByText(/正式输出阻断/);
    expect(readLatest).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
  });
  it("retains the exact saved selection after an explicit latest-head read becomes unknown", async () => {
    const r = result(),
      readLatest = vi
        .fn()
        .mockResolvedValueOnce({
          kind: "FOUND",
          receipt: { request_id: f.request_id, data: r.receipt.data.assembly },
        })
        .mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
    const get = vi.fn().mockResolvedValue(r);
    render(
      <AssemblyReadinessPanel
        projectId={f.project_id}
        episodeId={f.episode_id}
        assembly={{ readLatest } as unknown as EpisodeMediaAssemblyGateway}
        gateway={{ getEpisodeAssemblyReadiness: get }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "只读核对前置证据", hidden: true })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "读取本集最新保存版本", hidden: true }));
    await screen.findByRole("alert");
    expect(screen.getByText(new RegExp(r.receipt.data.assembly.version_id))).toBeInTheDocument();
    check();
    await screen.findByText(/正式输出阻断/);
    expect(readLatest).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledOnce();
  });
  it.each([
    "body-hash",
    "receipt",
    "scope",
    "approval",
    "extra",
    "version",
    "status-array",
    "scope-array",
    "invalid-date",
    "media-array",
    "media-ref",
    "missing-media",
    "assembly-extra",
  ])("retains unknown for corrupt %s without retry or changing the target", async (kind) => {
    const s = setup();
    const corrupt = structuredClone(s.r);
    if (kind === "body-hash") corrupt.receipt.data.assembly.content.canvas_width = 161;
    if (kind === "receipt") corrupt.receipt.request_id = "bad";
    if (kind === "scope") corrupt.receipt.data.assembly.content.episode_id = `ep_${"a".repeat(32)}`;
    if (kind === "approval") Object.assign(corrupt.receipt.data, { formal_status: "APPROVED" });
    if (kind === "extra") Object.assign(corrupt.receipt.data, { signed: true });
    if (kind === "version") corrupt.receipt.data.assembly.version_id = `ver_${"a".repeat(32)}`;
    if (kind === "status-array")
      Object.assign(corrupt.receipt.data.source_checks[0]!, { status: ["CURRENT"] });
    if (kind === "scope-array")
      Object.assign(corrupt.receipt.data.blockers[0]!, { scope: ["PICTURE_LOCK"] });
    if (kind === "invalid-date") corrupt.receipt.data.checked_at = "2026-02-30T12:00:00Z";
    if (kind === "media-array")
      Object.assign(corrupt.receipt.data.assembly.media_checks[0]!, { availability: ["VERIFIED"] });
    if (kind === "media-ref")
      corrupt.receipt.data.assembly.media_checks[0]!.media.asset_version_id = `asv_${"a".repeat(32)}`;
    if (kind === "missing-media") corrupt.receipt.data.assembly.media_checks = [];
    if (kind === "assembly-extra") Object.assign(corrupt.receipt.data.assembly, { signed: true });
    s.get.mockResolvedValue(corrupt);
    check();
    await screen.findByRole("alert");
    expect(screen.queryByText(/正式输出阻断/)).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(s.props.target.version_id))).toBeInTheDocument();
    expect(s.get).toHaveBeenCalledOnce();
  });
  it("drops a late A read after A→B→A, then checks the current A independently", async () => {
    const s = setup(),
      b = result(`prj_${"b".repeat(32)}`, `ep_${"c".repeat(32)}`);
    let finish!: (value: AssemblyReadinessResult) => void;
    s.get.mockImplementationOnce(
      () =>
        new Promise<AssemblyReadinessResult>((resolve) => {
          finish = resolve;
        }),
    );
    check();
    s.view.rerender(
      <AssemblyReadinessPanel
        {...s.props}
        projectId={b.receipt.data.assembly.content.project_id}
        episodeId={b.receipt.data.assembly.content.episode_id}
        target={{
          version_id: b.receipt.data.assembly.version_id,
          content_hash: b.receipt.data.assembly.content_hash,
        }}
      />,
    );
    s.view.rerender(<AssemblyReadinessPanel {...s.props} />);
    await act(async () => finish(s.r));
    expect(screen.queryByText(/正式输出阻断/)).not.toBeInTheDocument();
    check();
    await screen.findByText(/正式输出阻断/);
    expect(s.get).toHaveBeenCalledTimes(2);
  });
  it("discards in-flight hash verification after changing to another saved version", async () => {
    const s = setup();
    let finish!: (value: ArrayBuffer) => void;
    const digest = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("crypto", { subtle: { digest } });
    check();
    await waitFor(() => expect(digest).toHaveBeenCalledOnce());
    s.view.rerender(
      <AssemblyReadinessPanel
        {...s.props}
        target={{ ...s.props.target, version_id: `ver_${"b".repeat(32)}` }}
      />,
    );
    await act(async () => finish(new Uint8Array(32).buffer));
    expect(screen.queryByText(/正式输出阻断/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("labels an old head without adopting or saving it and allows an explicit fresh read after failure", async () => {
    const s = setup();
    s.r.receipt.data.is_current_head = false;
    s.get.mockRejectedValueOnce(new Error("offline"));
    check();
    await screen.findByRole("alert");
    expect(s.get).toHaveBeenCalledOnce();
    check();
    await screen.findByText(/此为旧保存版本/);
    expect(s.get).toHaveBeenCalledTimes(2);
  });
});
