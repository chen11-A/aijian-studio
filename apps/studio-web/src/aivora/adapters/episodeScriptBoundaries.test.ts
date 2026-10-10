import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeConfirmationJournal,
  closeScriptJournal,
  confirmScriptVersion,
  readAcceptedSourceBinding,
  readConfirmationJournal,
  readLatestScript,
  readScriptConfirmation,
  readScriptJournal,
  saveScriptVersion,
  validScriptVersion,
  type ConfirmationGateway,
  type ScriptConfirmationStatus,
  type ScriptGateway,
  type ScriptVersion,
  type ScriptWriteCommand,
  type SourceBindingGateway,
} from "./episodeScript";

const project = `prj_${"1".repeat(32)}`;
const episode = `ep_${"2".repeat(32)}`;
const versionId = `ver_${"3".repeat(32)}`;
const hash = `sha256:${"4".repeat(64)}`;
const operation = "11111111-1111-4111-8111-111111111111";
const scriptKey = `aivora.episode-script.pending.v1.${project}.${episode}`;
const confirmationKey = `aivora.episode-script.confirmation.pending.v1.${project}.${episode}`;

function command(): ScriptWriteCommand {
  return {
    operation_id: operation,
    payload: {
      parent_version_id: null,
      expected_revision: null,
      change_summary: "Local synthetic script",
      content: {
        schema_version: "1.0.0",
        project_id: project,
        episode_id: episode,
        production_brief_version_id: null,
        story_bible_version_id: null,
        source_extraction_version_id: null,
        source_proposal_acceptance_id: null,
        scenes: [
          {
            scene_id: `scn_${"5".repeat(32)}`,
            ordinal: 1,
            heading: "Interior",
            blocks: [
              {
                block_id: `sblk_${"6".repeat(32)}`,
                ordinal: 1,
                kind: "DIALOGUE",
                text: "Hello",
                speaker: "Actor",
                delivery: "ON_SCREEN",
              },
            ],
          },
        ],
      },
    },
  };
}

function version(): ScriptVersion {
  return {
    version_id: versionId,
    project_id: project,
    episode_id: episode,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content: command().payload.content,
    content_hash: hash,
    author_actor_id: "local-test",
    change_summary: "Synthetic",
    created_at: "2026-10-10T00:00:00Z",
  };
}

function scriptGateway() {
  return {
    getEpisodeScript: vi
      .fn<ScriptGateway["getEpisodeScript"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: version(), request_id: "get" } }),
    getEpisodeScriptVersion: vi
      .fn<ScriptGateway["getEpisodeScriptVersion"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: version(), request_id: "exact" } }),
    createEpisodeScriptVersion: vi
      .fn<ScriptGateway["createEpisodeScriptVersion"]>()
      .mockResolvedValue({
        kind: "CREATED",
        receipt: { data: { version: version(), replayed: false }, request_id: "post" },
      }),
  };
}

function status(): ScriptConfirmationStatus {
  return {
    project_id: project,
    episode_id: episode,
    latest_version_id: versionId,
    latest_head_revision: 1,
    current: true,
    confirmation: {
      confirmation_id: `esc_${"7".repeat(32)}`,
      project_id: project,
      episode_id: episode,
      artifact_id: `art_${"8".repeat(32)}`,
      version_id: versionId,
      content_hash: hash,
      head_revision: 1,
      actor_id: "local-test",
      confirmed_at: "2026-10-10T00:00:00Z",
    },
  };
}

function confirmationGateway() {
  return {
    getEpisodeScriptConfirmation: vi
      .fn<ConfirmationGateway["getEpisodeScriptConfirmation"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: status(), request_id: "get" } }),
    getEpisodeScriptConfirmationReceipt: vi
      .fn<ConfirmationGateway["getEpisodeScriptConfirmationReceipt"]>()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: status(), request_id: "exact" } }),
    createEpisodeScriptConfirmation: vi
      .fn<ConfirmationGateway["createEpisodeScriptConfirmation"]>()
      .mockResolvedValue({
        kind: "CREATED",
        receipt: { data: { status: status(), replayed: false }, request_id: "post" },
      }),
  };
}

beforeEach(() => localStorage.clear());

describe("script journal and exact readback", () => {
  test("persists intent before POST and closes only after exact GET", async () => {
    const gateway = scriptGateway();
    gateway.createEpisodeScriptVersion.mockImplementation(async () => {
      expect(readScriptJournal(localStorage, project, episode)).toMatchObject({
        kind: "PENDING",
        pending: { command: command() },
      });
      return {
        kind: "CREATED",
        receipt: { data: { version: version(), replayed: false }, request_id: "post" },
      };
    });
    expect(await saveScriptVersion(gateway, localStorage, project, episode, command())).toEqual({
      kind: "SAVED",
      version: version(),
    });
    expect(gateway.getEpisodeScriptVersion).toHaveBeenCalledWith(project, episode, versionId);
    expect(readScriptJournal(localStorage, project, episode)).toEqual({ kind: "EMPTY" });
  });

  test.each([401, 403, 409, 413, 422, 428])("definite rejection %s closes intent", async (code) => {
    const gateway = scriptGateway();
    gateway.createEpisodeScriptVersion.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: code,
      code: "REJECTED",
      request_id: "post",
    });
    expect(await saveScriptVersion(gateway, localStorage, project, episode, command())).toEqual({
      kind: "REJECTED",
      status: code,
      code: "REJECTED",
    });
    expect(localStorage.getItem(scriptKey)).toBeNull();
    expect(gateway.getEpisodeScriptVersion).not.toHaveBeenCalled();
  });

  test.each([404, 429, 500, 503])(
    "uncertain rejection %s preserves intent and forbids replay",
    async (code) => {
      const gateway = scriptGateway();
      gateway.createEpisodeScriptVersion.mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status: code,
        code: "UNKNOWN",
        request_id: "post",
      });
      expect(await saveScriptVersion(gateway, localStorage, project, episode, command())).toEqual({
        kind: "UNKNOWN",
      });
      expect(
        await saveScriptVersion(gateway, localStorage, project, episode, command()),
      ).toMatchObject({ kind: "BLOCKED" });
      expect(gateway.createEpisodeScriptVersion).toHaveBeenCalledTimes(1);
      expect(closeScriptJournal(localStorage, project, episode, "wrong")).toBe(false);
      expect(readScriptJournal(localStorage, project, episode).kind).toBe("PENDING");
    },
  );

  test.each(["version_id", "head_revision", "content_hash", "content"] as const)(
    "readback drift in %s stays UNKNOWN",
    async (field) => {
      const gateway = scriptGateway();
      const changed = version();
      if (field === "version_id") changed.version_id = `ver_${"9".repeat(32)}`;
      if (field === "head_revision") changed.head_revision = 2;
      if (field === "content_hash") changed.content_hash = `sha256:${"a".repeat(64)}`;
      if (field === "content") {
        const block = changed.content.scenes[0]?.blocks[0];
        if (!block) throw new Error("fixture missing dialogue");
        block.text = "Different";
      }
      gateway.getEpisodeScriptVersion.mockResolvedValue({
        kind: "FOUND",
        receipt: { data: changed, request_id: "exact" },
      });
      expect(await saveScriptVersion(gateway, localStorage, project, episode, command())).toEqual({
        kind: "UNKNOWN",
      });
      expect(readScriptJournal(localStorage, project, episode).kind).toBe("PENDING");
    },
  );

  test.each(["{", "null", "[]", "x".repeat(2_500_001)])(
    "corrupt journal is preserved (%#)",
    async (raw) => {
      localStorage.setItem(scriptKey, raw);
      const gateway = scriptGateway();
      expect(
        await saveScriptVersion(gateway, localStorage, project, episode, command()),
      ).toMatchObject({ kind: "BLOCKED" });
      expect(localStorage.getItem(scriptKey)).toBe(raw);
      expect(gateway.createEpisodeScriptVersion).not.toHaveBeenCalled();
    },
  );

  test("storage write failure prevents POST", async () => {
    const gateway = scriptGateway();
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("disk");
      },
      removeItem: vi.fn(),
    };
    expect(await saveScriptVersion(gateway, storage, project, episode, command())).toMatchObject({
      kind: "BLOCKED",
    });
    expect(gateway.createEpisodeScriptVersion).not.toHaveBeenCalled();
  });

  test("cleanup failure cannot report SAVED", async () => {
    const gateway = scriptGateway();
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: () => {
        throw new Error("disk");
      },
    };
    expect(await saveScriptVersion(gateway, storage, project, episode, command())).toEqual({
      kind: "UNKNOWN",
    });
    expect(readScriptJournal(localStorage, project, episode).kind).toBe("PENDING");
  });

  test("thrown transport leaves durable pending", async () => {
    const gateway = scriptGateway();
    gateway.createEpisodeScriptVersion.mockRejectedValue(new Error("lost receipt"));
    expect(await saveScriptVersion(gateway, localStorage, project, episode, command())).toEqual({
      kind: "UNKNOWN",
    });
    expect(readScriptJournal(localStorage, project, episode).kind).toBe("PENDING");
  });
});

describe("confirmation authority", () => {
  test("persists exact identity, reads exact receipt, and then closes", async () => {
    const gateway = confirmationGateway();
    gateway.createEpisodeScriptConfirmation.mockImplementation(async () => {
      expect(readConfirmationJournal(localStorage, project, episode)).toMatchObject({
        kind: "PENDING",
        pending: {
          operation_id: operation,
          payload: {
            version_id: versionId,
            expected_content_hash: hash,
            expected_head_revision: 1,
            confirm: true,
          },
        },
      });
      return {
        kind: "CREATED",
        receipt: { data: { status: status(), replayed: false }, request_id: "post" },
      };
    });
    expect(
      await confirmScriptVersion(gateway, localStorage, project, episode, version(), operation),
    ).toEqual({ kind: "CONFIRMED", status: status() });
    expect(gateway.getEpisodeScriptConfirmationReceipt).toHaveBeenCalledWith(
      project,
      episode,
      status().confirmation?.confirmation_id,
    );
    expect(readConfirmationJournal(localStorage, project, episode)).toEqual({ kind: "EMPTY" });
  });

  test.each([401, 403, 404, 409, 422, 428])(
    "definite confirmation rejection %s closes journal",
    async (code) => {
      const gateway = confirmationGateway();
      gateway.createEpisodeScriptConfirmation.mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status: code,
        code: "REJECTED",
        request_id: "post",
      });
      expect(
        await confirmScriptVersion(gateway, localStorage, project, episode, version(), operation),
      ).toEqual({ kind: "REJECTED", status: code, code: "REJECTED" });
      expect(readConfirmationJournal(localStorage, project, episode).kind).toBe("EMPTY");
    },
  );

  test.each([413, 429, 500])("uncertain confirmation rejection %s blocks replay", async (code) => {
    const gateway = confirmationGateway();
    gateway.createEpisodeScriptConfirmation.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: code,
      code: "UNKNOWN",
      request_id: "post",
    });
    expect(
      await confirmScriptVersion(gateway, localStorage, project, episode, version(), operation),
    ).toEqual({ kind: "UNKNOWN" });
    expect(
      await confirmScriptVersion(gateway, localStorage, project, episode, version(), operation),
    ).toMatchObject({ kind: "BLOCKED" });
    expect(gateway.createEpisodeScriptConfirmation).toHaveBeenCalledTimes(1);
    expect(closeConfirmationJournal(localStorage, project, episode, "wrong")).toBe(false);
    expect(readConfirmationJournal(localStorage, project, episode).kind).toBe("PENDING");
  });

  test.each(["current", "confirmation_id", "content_hash", "version_id"] as const)(
    "exact receipt drift in %s preserves pending",
    async (field) => {
      const gateway = confirmationGateway();
      const changed = status();
      if (!changed.confirmation) throw new Error("fixture missing confirmation");
      if (field === "current") changed.current = false;
      if (field === "confirmation_id")
        changed.confirmation.confirmation_id = `esc_${"9".repeat(32)}`;
      if (field === "content_hash") changed.confirmation.content_hash = `sha256:${"9".repeat(64)}`;
      if (field === "version_id") {
        changed.confirmation.version_id = `ver_${"9".repeat(32)}`;
        changed.latest_version_id = changed.confirmation.version_id;
      }
      gateway.getEpisodeScriptConfirmationReceipt.mockResolvedValue({
        kind: "FOUND",
        receipt: { data: changed, request_id: "exact" },
      });
      expect(
        await confirmScriptVersion(gateway, localStorage, project, episode, version(), operation),
      ).toEqual({ kind: "UNKNOWN" });
      expect(readConfirmationJournal(localStorage, project, episode).kind).toBe("PENDING");
    },
  );

  test.each(["{", "null", "[]", "x".repeat(2001)])(
    "corrupt confirmation journal blocks POST (%#)",
    async (raw) => {
      localStorage.setItem(confirmationKey, raw);
      const gateway = confirmationGateway();
      expect(
        await confirmScriptVersion(gateway, localStorage, project, episode, version(), operation),
      ).toMatchObject({ kind: "BLOCKED" });
      expect(localStorage.getItem(confirmationKey)).toBe(raw);
      expect(gateway.createEpisodeScriptConfirmation).not.toHaveBeenCalled();
    },
  );
});

describe("reads do not invent authority", () => {
  test("latest script handles exact missing, unrelated rejection and thrown reads separately", async () => {
    const gateway = scriptGateway();
    expect(await readLatestScript(gateway, project, episode)).toEqual({
      kind: "FOUND",
      version: version(),
    });
    gateway.getEpisodeScript.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 404,
      code: "SCRIPT_NOT_FOUND",
      request_id: "get",
    });
    expect(await readLatestScript(gateway, project, episode)).toEqual({ kind: "EMPTY" });
    gateway.getEpisodeScript.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 404,
      code: "PROJECT_NOT_FOUND",
      request_id: "get",
    });
    expect(await readLatestScript(gateway, project, episode)).toEqual({
      kind: "REJECTED",
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
    gateway.getEpisodeScript.mockRejectedValue(new Error("network"));
    expect(await readLatestScript(gateway, project, episode)).toEqual({ kind: "UNKNOWN" });
  });

  test("confirmation read distinguishes confirmed, rejected and unknown", async () => {
    const gateway = confirmationGateway();
    expect(await readScriptConfirmation(gateway, project, episode)).toEqual({
      kind: "FOUND",
      status: status(),
    });
    gateway.getEpisodeScriptConfirmation.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 403,
      code: "DENIED",
      request_id: "get",
    });
    expect(await readScriptConfirmation(gateway, project, episode)).toEqual({
      kind: "REJECTED",
      status: 403,
      code: "DENIED",
    });
    gateway.getEpisodeScriptConfirmation.mockRejectedValue(new Error("network"));
    expect(await readScriptConfirmation(gateway, project, episode)).toEqual({ kind: "UNKNOWN" });
  });

  test.each([
    ["version_id", "bad"],
    ["project_id", "bad"],
    ["episode_id", "bad"],
    ["version_number", 0],
    ["head_revision", -1],
    ["head_revision", 1.5],
    ["content_hash", "bad"],
    ["content", null],
  ])("invalid version %s is not authoritative", (field, value) => {
    expect(validScriptVersion({ ...version(), [field]: value }, project, episode)).toBe(false);
  });

  test("source acceptance must bind the exact current source", async () => {
    const acceptance = {
      acceptance_id: `pda_${"a".repeat(32)}`,
      project_id: project,
      source_extraction_version_id: versionId,
      source_extraction_content_hash: hash,
      latest_version_id: versionId,
      current: true,
    };
    const gateway = {
      getSourceExtraction: vi.fn<SourceBindingGateway["getSourceExtraction"]>().mockResolvedValue({
        kind: "FOUND",
        receipt: {
          data: {
            project_id: project,
            head: { latest_version_id: versionId },
            version: { id: versionId, content_hash: hash },
          },
        },
      }),
      getSourceProposalAcceptanceForVersion: vi
        .fn<SourceBindingGateway["getSourceProposalAcceptanceForVersion"]>()
        .mockResolvedValue({ kind: "FOUND", receipt: { data: acceptance } }),
    };
    expect(await readAcceptedSourceBinding(gateway, project)).toEqual({
      kind: "BOUND",
      binding: { sourceVersionId: versionId, acceptanceId: acceptance.acceptance_id },
    });
    gateway.getSourceProposalAcceptanceForVersion.mockResolvedValue({
      kind: "FOUND",
      receipt: { data: { ...acceptance, current: false } },
    });
    expect(await readAcceptedSourceBinding(gateway, project)).toEqual({ kind: "UNKNOWN" });
    gateway.getSourceProposalAcceptanceForVersion.mockResolvedValue({ kind: "NOT_FOUND" });
    expect(await readAcceptedSourceBinding(gateway, project)).toEqual({ kind: "UNBOUND" });
    gateway.getSourceExtraction.mockRejectedValue(new Error("network"));
    expect(await readAcceptedSourceBinding(gateway, project)).toEqual({ kind: "UNKNOWN" });
  });
});
