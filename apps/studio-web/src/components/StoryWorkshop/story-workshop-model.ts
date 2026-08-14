import type { SourceManifestResponse, StoryBibleVersionResponse } from "../../api/studio";

export type StoryWorkshopStep = "verify_sources" | "edit_draft" | "resolve_review" | "prepare_g2";
export type StoryWorkshopStatus = "idle" | "loading" | "ready" | "error";
export type StoryWorkshopUnavailableReason =
  "missing_story" | "g1_not_accepted" | "stale_g1" | "trusted_backend_missing";

export interface StoryDraft {
  base_version_id: string;
  base_content_hash: string;
  title: string;
  logline: string;
  notes: string;
  revision: number;
  dirty: boolean;
}

export interface StoryDisposition {
  target_id: string;
  target_type: "question" | "conflict";
  decision: "resolved" | "deferred" | "waived";
  note: string;
}

export interface StoryWorkshopMachine {
  currentStep: StoryWorkshopStep;
  status: StoryWorkshopStatus;
  sourceVerified: boolean;
  draftSaved: boolean;
  readyPackagePrepared: boolean;
  etag: string | null;
  message: string;
  unavailable: StoryWorkshopUnavailableReason | null;
  dispositions: StoryDisposition[];
  draft: StoryDraft | null;
}

export interface StoryWorkshopContext {
  manifest: SourceManifestResponse | null;
  story: StoryBibleVersionResponse["data"]["version"] | null | undefined;
  storyRole: "latest" | "review" | "accepted";
}

export interface MockActionOptions {
  ifMatch?: string | null;
  unavailable?: boolean;
}

export type MockActionResult =
  | { ok: true; machine: StoryWorkshopMachine }
  | { ok: false; status: 409 | 412 | 503; code: string; machine: StoryWorkshopMachine };

export function createInitialStoryWorkshopMachine(
  context: StoryWorkshopContext,
): StoryWorkshopMachine {
  const unavailable = unavailableReason(context);
  const story = context.story ?? null;
  return {
    currentStep: "verify_sources",
    status: unavailable ? "error" : "idle",
    sourceVerified: false,
    draftSaved: false,
    readyPackagePrepared: false,
    etag: story?.content_hash ?? null,
    message: unavailable ? unavailableMessage(unavailable) : "等待核对来源。",
    unavailable,
    dispositions: [],
    draft: story
      ? {
          base_version_id: story.id,
          base_content_hash: story.content_hash,
          title: story.content.title,
          logline: story.content.logline,
          notes: "",
          revision: 0,
          dirty: false,
        }
      : null,
  };
}

export function unavailableReason({
  manifest,
  story,
}: StoryWorkshopContext): StoryWorkshopUnavailableReason | null {
  if (!manifest?.data.head.accepted_version_id) return "g1_not_accepted";
  if (!story) return "missing_story";
  if (
    story.content.source_scope.source_manifest_version_id !== manifest.data.head.accepted_version_id
  ) {
    return "stale_g1";
  }
  return null;
}

export function unavailableMessage(reason: StoryWorkshopUnavailableReason): string {
  return {
    missing_story: "还没有故事设定，不能创建草稿。",
    g1_not_accepted: "原文还没确认，不能开始改设定。",
    stale_g1: "故事设定依据的原文已更新，需要重新整理或重审。",
    trusted_backend_missing: "还不能正式提交或签署，本页只做本机准备。",
  }[reason];
}

export function updateDraft(machine: StoryWorkshopMachine, patch: Partial<StoryDraft>) {
  if (!machine.draft) return machine;
  return {
    ...machine,
    currentStep: "edit_draft" as const,
    draftSaved: false,
    readyPackagePrepared: false,
    message: "草稿有本机修改，还不是最新稿、审阅中或已通过的版本。",
    draft: { ...machine.draft, ...patch, dirty: true },
  };
}

export function upsertDisposition(
  machine: StoryWorkshopMachine,
  disposition: StoryDisposition,
): StoryWorkshopMachine {
  const next = machine.dispositions.filter(
    (item) =>
      item.target_type !== disposition.target_type || item.target_id !== disposition.target_id,
  );
  return {
    ...machine,
    currentStep: "resolve_review",
    readyPackagePrepared: false,
    message: `${disposition.target_type === "question" ? "开放问题" : "冲突"}已记录本地处置。`,
    dispositions: [...next, disposition],
  };
}

function etagExpired(machine: StoryWorkshopMachine, ifMatch: string | null | undefined) {
  return Boolean(machine.etag && ifMatch && ifMatch !== machine.etag);
}

export function mockVerifySources(
  machine: StoryWorkshopMachine,
  options: MockActionOptions = {},
): MockActionResult {
  if (options.unavailable) {
    return unavailableResult(machine);
  }
  if (machine.unavailable) {
    return {
      ok: false,
      status: 409,
      code: machine.unavailable.toUpperCase(),
      machine: { ...machine, status: "error", message: unavailableMessage(machine.unavailable) },
    };
  }
  return {
    ok: true,
    machine: {
      ...machine,
      currentStep: "edit_draft",
      status: "ready",
      sourceVerified: true,
      message: "已确认的原文已核对。本机草稿还不是正式通过的设定。",
    },
  };
}

export function mockSaveDraft(
  machine: StoryWorkshopMachine,
  options: MockActionOptions = {},
): MockActionResult {
  if (options.unavailable) return unavailableResult(machine);
  if (!machine.sourceVerified) {
    return conflictResult(machine, "SOURCE_VERIFICATION_REQUIRED");
  }
  if (etagExpired(machine, options.ifMatch)) {
    return {
      ok: false,
      status: 412,
      code: "ETAG_EXPIRED",
      machine: { ...machine, status: "error", message: "草稿基线已过期，请重新读取版本。" },
    };
  }
  const nextEtag = `${machine.draft?.base_content_hash ?? "draft"}:${(machine.draft?.revision ?? 0) + 1}`;
  return {
    ok: true,
    machine: {
      ...machine,
      currentStep: "resolve_review",
      status: "ready",
      draftSaved: true,
      etag: nextEtag,
      message: "草稿已保存在本机，尚未送审，也还没正式通过。",
      draft: machine.draft
        ? { ...machine.draft, revision: machine.draft.revision + 1, dirty: false }
        : null,
    },
  };
}

export function mockPrepareG2Package(
  machine: StoryWorkshopMachine,
  options: MockActionOptions = {},
): MockActionResult {
  if (options.unavailable) return unavailableResult(machine);
  if (!machine.draftSaved) return conflictResult(machine, "DRAFT_SAVE_REQUIRED");
  return {
    ok: false,
    status: 503,
    code: "TRUSTED_BACKEND_MISSING",
    machine: {
      ...machine,
      currentStep: "prepare_g2",
      status: "error",
      readyPackagePrepared: true,
      unavailable: "trusted_backend_missing",
      message: unavailableMessage("trusted_backend_missing"),
    },
  };
}

function conflictResult(machine: StoryWorkshopMachine, code: string): MockActionResult {
  return {
    ok: false,
    status: 409,
    code,
    machine: {
      ...machine,
      status: "error",
      message: "请按「核对原文 → 保存草稿 → 处理问题」的顺序操作。",
    },
  };
}

function unavailableResult(machine: StoryWorkshopMachine): MockActionResult {
  return {
    ok: false,
    status: 503,
    code: "STORY_WORKSHOP_UNAVAILABLE",
    machine: { ...machine, status: "error", message: "故事设定操作暂时不可用。" },
  };
}
