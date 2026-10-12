import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import f from "../../../../../packages/contracts/fixtures/manual-media-candidate.json";
import { saveCandidate, recoverCandidate, readCandidateJournal } from "./manualMediaCandidate";
import { submitAssemblyExact, readAssemblyExactJournal } from "./assemblyExact";
import type {
  ManualMediaCandidateCommand,
  ManualMediaCandidateGateway,
} from "@aijian/contracts/manual-media-candidate";
import type { AssemblyExactCommand, AssemblyExactGateway } from "@aijian/contracts/assembly-exact";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());
function flow(kind: "candidate" | "assembly") {
  const command =
    kind === "candidate"
      ? (f.candidate_command as ManualMediaCandidateCommand)
      : (f.assembly_command as AssemblyExactCommand);
  const data = kind === "candidate" ? f.candidate_operation : f.assembly_operation;
  const write = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    read = vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data, request_id: f.request_id } });
  const candidateApi = {
    saveManualMediaCandidate: write,
    getManualMediaCandidateOperation: read,
  } as unknown as ManualMediaCandidateGateway;
  const assemblyApi = { saveExact: write, getOriginal: read } as AssemblyExactGateway;
  return {
    command,
    data,
    write,
    read,
    key:
      kind === "candidate"
        ? `aivora.manual-media-candidate.pending.v1.${f.project_id}.${f.episode_id}`
        : `aivora.assembly-exact.pending.v2.${f.project_id}.${f.episode_id}`,
    journal: () =>
      kind === "candidate"
        ? readCandidateJournal(localStorage, f.project_id, f.episode_id)
        : readAssemblyExactJournal(localStorage, f.project_id, f.episode_id),
    run: (
      recover = false,
      active = () => true,
      storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
    ) =>
      kind === "candidate"
        ? (recover ? recoverCandidate : saveCandidate)(
            candidateApi,
            storage,
            command as ManualMediaCandidateCommand,
            active,
          )
        : submitAssemblyExact(
            assemblyApi,
            storage,
            command as AssemblyExactCommand,
            active,
            recover,
          ),
  };
}
test.each(["candidate", "assembly"] as const)(
  "%s full intent is durable before first POST; UNKNOWN never replays",
  async (kind) => {
    const env = flow(kind);
    env.write.mockImplementation(async () => {
      expect(JSON.parse(localStorage.getItem(env.key)!)).toEqual(env.command);
      return { kind: "REMOTE_UNKNOWN" };
    });
    expect((await env.run()).kind).toBe("UNKNOWN");
    expect((await env.run()).kind).toBe("UNKNOWN");
    expect(env.write).toHaveBeenCalledOnce();
    expect((await env.run(true)).kind).toBe("SAVED");
    expect(env.read).toHaveBeenCalledExactlyOnceWith(f.project_id, f.episode_id, env.command);
    expect(env.journal().kind).toBe("EMPTY");
    expect(env.write).toHaveBeenCalledOnce();
  },
);
test.each(
  (["candidate", "assembly"] as const).flatMap((kind) =>
    ["missing", "replacement", "noop-delete", "stale", "hash", "old-schema"].map(
      (fault) => [kind, fault] as const,
    ),
  ),
)("%s %s cannot close or resend original intent", async (kind, fault) => {
  const env = flow(kind);
  let resolve!: (v: unknown) => void;
  env.write.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = env.run(
    false,
    () => fault !== "stale",
    fault === "noop-delete"
      ? {
          getItem: (k) => localStorage.getItem(k),
          setItem: (k, v) => localStorage.setItem(k, v),
          removeItem: () => {},
        }
      : localStorage,
  );
  const original = localStorage.getItem(env.key)!;
  if (fault === "missing") localStorage.removeItem(env.key);
  if (fault === "replacement") localStorage.setItem(env.key, "replacement-unresolved-Y");
  const data = structuredClone(env.data);
  if (fault === "hash") data.version.content_hash = "sha256:" + "0".repeat(64);
  if (fault === "old-schema") data.version.content.schema_version = "0.9.0";
  resolve({ kind: "FOUND", receipt: { data, request_id: f.request_id } });
  expect((await pending).kind).toBe("UNKNOWN");
  expect(localStorage.getItem(env.key)).toBe(
    fault === "replacement" ? "replacement-unresolved-Y" : original,
  );
  expect((await env.run()).kind).toBe("UNKNOWN");
  expect(env.write).toHaveBeenCalledOnce();
  if (fault === "missing") {
    expect((await env.run(true)).kind).toBe("SAVED");
    expect(env.read).toHaveBeenCalledOnce();
  }
});
test.each(["candidate", "assembly"] as const)(
  "%s missing journal after a definite rejection restores X and stays UNKNOWN",
  async (kind) => {
    const env = flow(kind);
    env.write.mockImplementation(async () => {
      localStorage.removeItem(env.key);
      return {
        kind: "DEFINITE_SERVER_ERROR",
        status: 422,
        code:
          kind === "candidate"
            ? "MANUAL_MEDIA_CANDIDATE_INPUT_REJECTED"
            : "ASSEMBLY_INPUT_REJECTED",
        request_id: f.request_id,
      };
    });
    expect((await env.run()).kind).toBe("UNKNOWN");
    expect(JSON.parse(localStorage.getItem(env.key)!)).toEqual(env.command);
    expect(env.write).toHaveBeenCalledOnce();
  },
);
test.each(["candidate", "assembly"] as const)(
  "%s GET absence or bad attribution never grants another POST",
  async (kind) => {
    const env = flow(kind);
    await env.run();
    env.read.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    expect((await env.run(true)).kind).toBe("UNKNOWN");
    env.read.mockResolvedValue({
      kind: "FOUND",
      receipt: { data: env.data, request_id: "not-original-response-uuid" },
    });
    expect((await env.run(true)).kind).toBe("UNKNOWN");
    expect(env.journal().kind).toBe("PENDING");
    expect(env.write).toHaveBeenCalledOnce();
  },
);
test("legacy assembly v1 log stays untouched and blocks v2 POST/GET; latest-content match cannot infer success", async () => {
  const env = flow("assembly"),
    key = `aivora:episode-media-assembly:pending:${f.project_id}:${f.episode_id}`;
  localStorage.setItem(key, JSON.stringify({ content: f.assembly_command.payload.content }));
  expect((await env.run()).kind).toBe("UNKNOWN");
  expect((await env.run(true)).kind).toBe("UNKNOWN");
  expect(env.journal().kind).toBe("LEGACY_BLOCKED");
  expect(env.write).not.toHaveBeenCalled();
  expect(env.read).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).not.toBeNull();
  expect(localStorage.getItem(env.key)).toBeNull();
});
