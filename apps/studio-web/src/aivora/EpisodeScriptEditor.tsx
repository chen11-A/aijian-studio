import { useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import { Button } from "./Common";
import { ScriptSceneBlocks } from "./ScriptSceneBlocks";
import { ScriptWorkspaceView } from "./ScriptWorkspaceView";
import { buildScriptSelection, usePublishAssistantSelection } from "./assistantSelection";
import { AcceptedSourceSummarySeed } from "./AcceptedSourceSummarySeed";
import { OfficialTextProposalPanel } from "./OfficialTextProposalPanel";
import { summaryStartingScene } from "./adapters/acceptedSourceSummary";
import {
  closeConfirmationJournal,
  closeScriptJournal,
  confirmScriptVersion,
  newScriptId,
  readAcceptedSourceBinding,
  readLatestScript,
  readConfirmationJournal,
  readScriptConfirmation,
  readScriptJournal,
  saveScriptVersion,
} from "./adapters/episodeScript";
import type {
  AcceptedSourceBinding,
  ConfirmationGateway,
  ConfirmationJournal,
  ScriptBlock,
  ScriptConfirmationStatus,
  ScriptGateway,
  ScriptJournal,
  ScriptScene,
  ScriptVersion,
  ScriptWriteCommand,
  ScriptWriteContent,
  ScriptWriteScene,
  SourceBindingGateway,
  SourceBindingRead,
} from "./adapters/episodeScript";

type Props = {
  projectId: string | null;
  episodeId: string | null;
  briefVersionId: string | null;
  episodeTitle?: string;
  setNavigationGuard?: (guard: (() => boolean) | null) => void;
  onOpenSource?: () => void;
  workspace?: boolean;
};
const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const cloneScenes = (scenes: ScriptScene[]): ScriptScene[] =>
  scenes.map((scene) => ({ ...scene, blocks: scene.blocks.map((block) => ({ ...block })) }));
const normalizeScenes = (scenes: ScriptScene[]): ScriptScene[] =>
  scenes.map((scene, index) => ({
    ...scene,
    ordinal: index + 1,
    blocks: scene.blocks.map((block, blockIndex) => ({ ...block, ordinal: blockIndex + 1 })),
  }));
function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const reordered = [...items];
  const [item] = reordered.splice(index, 1);
  if (item !== undefined) reordered.splice(target, 0, item);
  return reordered;
}

function prepareContent(
  projectId: string,
  episodeId: string,
  current: ScriptVersion | null,
  scenes: ScriptScene[],
  briefVersionId: string | null,
  sourceBinding: SourceBindingRead,
): ScriptWriteContent | string {
  if (!PROJECT.test(projectId) || !EPISODE.test(episodeId)) return "项目或剧集标识无效。";
  if (scenes.length > 1_000) return "场次数量超过上限。";
  if (
    current &&
    !!current.content.source_extraction_version_id !==
      !!current.content.source_proposal_acceptance_id
  )
    return "旧稿来源版本与接纳记录不完整；需先核对权威来源绑定，不能推断后保存。";
  const ids = new Set<string>();
  for (const scene of scenes) {
    if (!scene.heading.trim() || [...scene.heading].length > 240 || scene.blocks.length > 500)
      return "场次标题需为 1 至 240 字，每场最多 500 段。";
    if (ids.has(scene.scene_id)) return "场次标识重复。";
    ids.add(scene.scene_id);
    for (const block of scene.blocks) {
      if (ids.has(block.block_id)) return "段落标识重复。";
      ids.add(block.block_id);
      if (!block.text.trim() || [...block.text].length > 20_000)
        return "每段内容需为 1 至 20000 字，不能只有空白。";
      if (
        block.kind === "DIALOGUE" &&
        (!block.speaker?.trim() ||
          [...block.speaker].length > 120 ||
          (block.delivery !== "ON_SCREEN" && block.delivery !== "OFF_SCREEN"))
      )
        return "对白必须填写说话人，并明确画内或画外。";
      if (block.kind === "ACTION" && (block.speaker != null || block.delivery != null))
        return "动作段不能带说话人或对白呈现方式。";
    }
  }
  const writeScenes: ScriptWriteScene[] = normalizeScenes(scenes).map((scene) => ({
    ...scene,
    blocks: scene.blocks.map((block) =>
      block.kind === "ACTION"
        ? { ...block, speaker: null, delivery: null }
        : { ...block, delivery: block.delivery! },
    ),
  }));
  const content: ScriptWriteContent = {
    schema_version: "1.0.0",
    project_id: projectId,
    episode_id: episodeId,
    production_brief_version_id: current
      ? (current.content.production_brief_version_id ?? null)
      : briefVersionId,
    story_bible_version_id: current?.content.story_bible_version_id ?? null,
    source_extraction_version_id: current
      ? (current.content.source_extraction_version_id ?? null)
      : sourceBinding.kind === "BOUND"
        ? sourceBinding.binding.sourceVersionId
        : null,
    source_proposal_acceptance_id: current
      ? (current.content.source_proposal_acceptance_id ?? null)
      : sourceBinding.kind === "BOUND"
        ? sourceBinding.binding.acceptanceId
        : null,
    scenes: writeScenes,
  };
  if (new TextEncoder().encode(JSON.stringify(content)).length > 2_000_000)
    return "剧本内容超过 2 MB 上限。";
  return content;
}

export function EpisodeScriptEditor({
  projectId,
  episodeId,
  briefVersionId,
  episodeTitle,
  setNavigationGuard,
  onOpenSource,
  workspace = false,
}: Props) {
  const transport = useMemo(
    () =>
      createStudioTransport() as unknown as Partial<
        ScriptGateway & ConfirmationGateway & SourceBindingGateway
      >,
    [],
  );
  const gateway = useMemo<ScriptGateway | null>(
    () =>
      typeof transport.getEpisodeScript === "function" &&
      typeof transport.getEpisodeScriptVersion === "function" &&
      typeof transport.createEpisodeScriptVersion === "function"
        ? (transport as ScriptGateway)
        : null,
    [transport],
  );
  const confirmationGateway = useMemo<ConfirmationGateway | null>(
    () =>
      typeof transport.getEpisodeScriptConfirmation === "function" &&
      typeof transport.getEpisodeScriptConfirmationReceipt === "function" &&
      typeof transport.createEpisodeScriptConfirmation === "function"
        ? (transport as ConfirmationGateway)
        : null,
    [transport],
  );
  const sourceGateway = useMemo<SourceBindingGateway | null>(
    () =>
      typeof transport.getSourceExtraction === "function" &&
      typeof transport.getSourceProposalAcceptanceForVersion === "function"
        ? (transport as SourceBindingGateway)
        : null,
    [transport],
  );
  const storage = useMemo(() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const importedSourceBinding = useRef<AcceptedSourceBinding | null>(null);
  const [version, setVersion] = useState<ScriptVersion | null>(null);
  const [scenes, setScenes] = useState<ScriptScene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [journal, setJournal] = useState<ScriptJournal>({ kind: "EMPTY" });
  const [confirmationJournal, setConfirmationJournal] = useState<ConfirmationJournal>({
    kind: "EMPTY",
  });
  const [confirmation, setConfirmation] = useState<ScriptConfirmationStatus | null>(null);
  const [confirmationReadState, setConfirmationReadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [sourceBinding, setSourceBinding] = useState<SourceBindingRead>({ kind: "UNKNOWN" });
  const [inspectedConfirmation, setInspectedConfirmation] = useState(false);
  const [readState, setReadState] = useState<"loading" | "empty" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [inspectedPending, setInspectedPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [changeSummary, setChangeSummary] = useState("人工编辑分集剧本草稿");
  const [bindCurrentBrief, setBindCurrentBrief] = useState(false);
  const validScope =
    !!projectId && !!episodeId && PROJECT.test(projectId) && EPISODE.test(episodeId);
  const selected = scenes.find((scene) => scene.scene_id === selectedSceneId) ?? scenes[0];
  const dirty =
    bindCurrentBrief ||
    JSON.stringify(normalizeScenes(scenes)) !== JSON.stringify(version?.content.scenes ?? []);
  usePublishAssistantSelection(
    projectId && episodeId
      ? buildScriptSelection({
          projectId,
          episodeId,
          version,
          selectedSceneId: selected?.scene_id ?? null,
          dirty,
          readState,
        })
      : { kind: "NONE" },
  );
  const unknownDelivery = scenes.some((scene) =>
    scene.blocks.some((block) => block.kind === "DIALOGUE" && block.delivery == null),
  );
  const incompleteSourceBinding =
    !!version &&
    !!version.content.source_extraction_version_id !==
      !!version.content.source_proposal_acceptance_id;
  const confirmableContent =
    !!version?.content.scenes.length &&
    version.content.scenes.every((scene) => scene.blocks.length > 0) &&
    !incompleteSourceBinding &&
    !version.content.scenes.some((scene) =>
      scene.blocks.some((block) => block.kind === "DIALOGUE" && block.delivery == null),
    ) &&
    !!(
      version.content.production_brief_version_id ||
      version.content.story_bible_version_id ||
      version.content.source_extraction_version_id
    );
  const locked =
    busy ||
    readState === "loading" ||
    readState === "error" ||
    needsReload ||
    journal.kind !== "EMPTY";
  const sourceReady =
    !!version || sourceBinding.kind === "BOUND" || sourceBinding.kind === "UNBOUND";
  const leaveState = useRef({ dirty, busy, version });
  leaveState.current = { dirty, busy, version };

  useEffect(() => {
    setNavigationGuard?.(() => {
      const current = leaveState.current;
      if (current.busy || inFlight.current) {
        setNotice("正在核对或保存剧本，请等待结果后再切换页面、作品或剧集。");
        return false;
      }
      if (!current.dirty) return true;
      if (!window.confirm("当前剧本有未保存的修改。放弃修改并离开吗？")) return false;
      leaveState.current.dirty = false;
      setScenes(cloneScenes(current.version?.content.scenes ?? []));
      setBindCurrentBrief(false);
      return true;
    });
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaveState.current.dirty && !leaveState.current.busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      setNavigationGuard?.(null);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [setNavigationGuard]);

  useEffect(() => {
    if (!projectId || !sourceGateway) {
      setSourceBinding({ kind: "UNKNOWN" });
      return;
    }
    let active = true;
    setSourceBinding({ kind: "UNKNOWN" });
    void readAcceptedSourceBinding(sourceGateway, projectId).then((result) => {
      if (active && !importedSourceBinding.current) setSourceBinding(result);
    });
    return () => {
      active = false;
    };
  }, [projectId, sourceGateway]);

  useEffect(() => {
    const request = ++epoch.current;
    importedSourceBinding.current = null;
    setVersion(null);
    setScenes([]);
    setSelectedSceneId(null);
    setReadState("loading");
    setConfirmation(null);
    setConfirmationReadState("idle");
    setNotice("");
    setBindCurrentBrief(false);
    setInspectedPending(false);
    if (!validScope || !gateway || !storage || !projectId || !episodeId) {
      setReadState("error");
      return () => {
        epoch.current += 1;
      };
    }
    setJournal(readScriptJournal(storage, projectId, episodeId));
    setConfirmationJournal(readConfirmationJournal(storage, projectId, episodeId));
    void readLatestScript(gateway, projectId, episodeId).then((result) => {
      if (epoch.current !== request) return;
      if (result.kind === "FOUND") {
        setVersion(result.version);
        setScenes(cloneScenes(result.version.content.scenes));
        setSelectedSceneId(result.version.content.scenes[0]?.scene_id ?? null);
        setReadState("ready");
      } else if (result.kind === "EMPTY") {
        setReadState("empty");
      } else {
        setReadState("error");
        setNotice(
          result.kind === "REJECTED"
            ? `剧本读取被拒绝（${result.status} / ${result.code}）。`
            : "剧本读取结果未知；未使用样例内容填充。 ",
        );
      }
    });
    return () => {
      epoch.current += 1;
    };
  }, [projectId, episodeId, gateway, storage, validScope]);

  useEffect(() => {
    if (!version || !confirmationGateway || !projectId || !episodeId || !storage) return;
    let active = true;
    setConfirmationReadState("loading");
    setConfirmationJournal(readConfirmationJournal(storage, projectId, episodeId));
    void readScriptConfirmation(confirmationGateway, projectId, episodeId).then((result) => {
      if (!active) return;
      if (result.kind === "FOUND") {
        if (
          result.status.current &&
          result.status.confirmation?.content_hash !== version.content_hash
        ) {
          setConfirmationReadState("error");
          setNotice("确认回执与已读剧本哈希不一致，已阻止确认。");
          return;
        }
        setConfirmation(result.status);
        setConfirmationReadState("ready");
        if (
          result.status.latest_version_id !== version.version_id ||
          result.status.latest_head_revision !== version.head_revision
        ) {
          setNeedsReload(true);
          setNotice("剧本头已变化，请重新读取当前版本。");
        }
      } else {
        setConfirmationReadState("error");
        setNotice("当前版本的人工确认状态无法核实，已阻止确认。");
      }
    });
    return () => {
      active = false;
    };
  }, [version?.version_id, confirmationGateway, projectId, episodeId, storage]);

  async function refresh(discardDraft: boolean) {
    if (!validScope || !gateway || !storage || !projectId || !episodeId || inFlight.current) return;
    if (dirty && !discardDraft) {
      setNotice("先取消草稿，再读取服务器当前剧本。");
      return;
    }
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    const result = await readLatestScript(gateway, projectId, episodeId);
    const source = sourceGateway
      ? await readAcceptedSourceBinding(sourceGateway, projectId)
      : { kind: "UNKNOWN" as const };
    inFlight.current = false;
    if (epoch.current !== request) return;
    setBusy(false);
    setBindCurrentBrief(false);
    setJournal(readScriptJournal(storage, projectId, episodeId));
    if (result.kind === "FOUND" || result.kind === "EMPTY") {
      importedSourceBinding.current = null;
      setSourceBinding(source);
    }
    if (result.kind === "FOUND") {
      setVersion(result.version);
      setScenes(cloneScenes(result.version.content.scenes));
      setSelectedSceneId(result.version.content.scenes[0]?.scene_id ?? null);
      setReadState("ready");
    } else if (result.kind === "EMPTY") {
      setVersion(null);
      setScenes([]);
      setSelectedSceneId(null);
      setReadState("empty");
    } else {
      setReadState("error");
      setNotice("无法核实当前剧本，仍阻止提交。");
      return;
    }
    setNeedsReload(false);
    setInspectedPending(true);
    setNotice(
      journal.kind === "PENDING"
        ? "已只读核对当前剧本；此前提交结果仍未知。可显式结束未知记录后重新编辑。"
        : "已读取当前分集剧本。",
    );
  }

  function finishPending() {
    if (
      !storage ||
      !projectId ||
      !episodeId ||
      !inspectedPending ||
      journal.kind !== "PENDING" ||
      readState === "error" ||
      busy
    )
      return;
    if (closeScriptJournal(storage, projectId, episodeId, journal.pending.command.operation_id)) {
      setJournal({ kind: "EMPTY" });
      setNotice("已结束未知提交记录；未归因原提交结果。下一次保存是新操作。");
    } else setNotice("未知记录无法安全关闭，仍阻止提交。");
  }

  async function refreshSourceBinding() {
    if (
      !sourceGateway ||
      !projectId ||
      inFlight.current ||
      leaveState.current.dirty ||
      importedSourceBinding.current
    )
      return;
    inFlight.current = true;
    setBusy(true);
    const result = await readAcceptedSourceBinding(sourceGateway, projectId);
    inFlight.current = false;
    setBusy(false);
    setSourceBinding(result);
    setNotice(
      result.kind === "BOUND"
        ? "已核对当前采纳来源与权威接纳记录。"
        : result.kind === "UNBOUND"
          ? "当前没有可绑定的已采纳来源。"
          : "来源接纳状态无法核实；新剧本草稿保持禁用。",
    );
  }

  async function refreshConfirmation() {
    if (
      !confirmationGateway ||
      !projectId ||
      !episodeId ||
      !storage ||
      !version ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setBusy(true);
    const result = await readScriptConfirmation(confirmationGateway, projectId, episodeId);
    inFlight.current = false;
    setBusy(false);
    setConfirmationJournal(readConfirmationJournal(storage, projectId, episodeId));
    if (result.kind === "FOUND") {
      if (
        result.status.current &&
        result.status.confirmation?.content_hash !== version.content_hash
      ) {
        setConfirmationReadState("error");
        setNotice("确认回执与已读剧本哈希不一致，已阻止确认。");
        return;
      }
      setConfirmation(result.status);
      setConfirmationReadState("ready");
      setInspectedConfirmation(true);
      if (
        result.status.latest_version_id !== version.version_id ||
        result.status.latest_head_revision !== version.head_revision
      )
        setNeedsReload(true);
      setNotice(
        confirmationJournal.kind === "PENDING"
          ? "已只读核对确认状态；原确认提交仍不能归因。可显式结束未知记录。"
          : "已读取人工确认状态。",
      );
    } else {
      setConfirmationReadState("error");
      setNotice("人工确认状态读取失败，未发起新确认。");
    }
  }

  function finishConfirmationPending() {
    if (
      !storage ||
      !projectId ||
      !episodeId ||
      !inspectedConfirmation ||
      confirmationJournal.kind !== "PENDING" ||
      confirmationReadState !== "ready" ||
      busy
    )
      return;
    if (
      closeConfirmationJournal(
        storage,
        projectId,
        episodeId,
        confirmationJournal.pending.operation_id,
      )
    ) {
      setConfirmationJournal({ kind: "EMPTY" });
      setNotice("已结束未知确认记录；未归因原提交。可重新核对当前版本再操作。");
    } else setNotice("未知确认记录无法安全关闭，仍阻止再次确认。");
  }

  async function confirmCurrentVersion() {
    if (
      !confirmationGateway ||
      !storage ||
      !projectId ||
      !episodeId ||
      !version ||
      dirty ||
      !confirmableContent ||
      unknownDelivery ||
      busy ||
      inFlight.current ||
      readState !== "ready" ||
      confirmationReadState !== "ready" ||
      !confirmation ||
      confirmation.current ||
      confirmation.latest_version_id !== version.version_id ||
      confirmation.latest_head_revision !== version.head_revision ||
      confirmationJournal.kind !== "EMPTY" ||
      journal.kind !== "EMPTY"
    )
      return;
    let operationId: string;
    try {
      operationId = crypto.randomUUID();
    } catch {
      setNotice("无法生成确认身份，未发送。");
      return;
    }
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    setNotice("正在确认当前剧本版本并精确读回确认记录…");
    const result = await confirmScriptVersion(
      confirmationGateway,
      storage,
      projectId,
      episodeId,
      version,
      operationId,
    );
    inFlight.current = false;
    if (epoch.current !== request) return;
    setBusy(false);
    setConfirmationJournal(readConfirmationJournal(storage, projectId, episodeId));
    if (result.kind === "CONFIRMED") {
      setConfirmation(result.status);
      setConfirmationReadState("ready");
      setNotice("当前剧本版本已人工确认，确认回执已精确读回。");
    } else if (result.kind === "REJECTED") {
      setConfirmationReadState("error");
      setNotice(`剧本确认被拒绝（${result.status} / ${result.code}）；请重新读取版本与确认状态。`);
    } else if (result.kind === "UNKNOWN") {
      setNotice("确认结果未知；原操作已持久锁定，不会自动重试。请只读核对。");
    } else setNotice(result.message);
  }

  function addScene() {
    if (locked) return;
    const sceneId = newScriptId("scn");
    if (!sceneId) {
      setNotice("无法生成场次标识，未添加场次。");
      return;
    }
    setScenes((old) => [
      ...old,
      { scene_id: sceneId, ordinal: old.length + 1, heading: "新场次", blocks: [] },
    ]);
    setSelectedSceneId(sceneId);
  }
  function updateScene(sceneId: string, update: (scene: ScriptScene) => ScriptScene) {
    setScenes((old) => old.map((scene) => (scene.scene_id === sceneId ? update(scene) : scene)));
  }
  function addBlock(sceneId: string, kind: ScriptBlock["kind"]) {
    if (locked) return;
    const blockId = newScriptId("sblk");
    if (!blockId) {
      setNotice("无法生成段落标识，未添加段落。");
      return;
    }
    updateScene(sceneId, (scene) => ({
      ...scene,
      blocks: [
        ...scene.blocks,
        {
          block_id: blockId,
          ordinal: scene.blocks.length + 1,
          kind,
          text: "",
          speaker: kind === "DIALOGUE" ? "" : null,
          delivery: null,
        },
      ],
    }));
  }

  async function save() {
    if (
      !gateway ||
      !storage ||
      !projectId ||
      !episodeId ||
      !validScope ||
      locked ||
      !dirty ||
      inFlight.current
    )
      return;
    if (!sourceReady) {
      setNotice("已接受来源状态尚未核实，未发送新剧本草稿。");
      return;
    }
    const content = prepareContent(
      projectId,
      episodeId,
      version,
      scenes,
      briefVersionId,
      importedSourceBinding.current
        ? { kind: "BOUND", binding: importedSourceBinding.current }
        : sourceBinding,
    );
    if (typeof content === "string") {
      setNotice(content);
      return;
    }
    if (bindCurrentBrief) {
      if (!briefVersionId) {
        setNotice("当前创作简报尚未读取，未保存绑定。");
        return;
      }
      content.production_brief_version_id = briefVersionId;
    }
    const summary = changeSummary.trim();
    if (!summary || [...summary].length > 240) {
      setNotice("修改说明需为 1 至 240 字。");
      return;
    }
    let operationId: string;
    try {
      operationId = crypto.randomUUID();
    } catch {
      setNotice("无法生成本次提交身份，未发送剧本。");
      return;
    }
    const command: ScriptWriteCommand = {
      operation_id: operationId,
      payload: {
        content,
        parent_version_id: version?.version_id ?? null,
        expected_revision: version?.head_revision ?? null,
        change_summary: summary,
      },
    };
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    setNotice("正在保存草稿并读取精确版本…");
    const result = await saveScriptVersion(gateway, storage, projectId, episodeId, command);
    inFlight.current = false;
    if (epoch.current !== request) return;
    setBusy(false);
    setJournal(readScriptJournal(storage, projectId, episodeId));
    if (result.kind === "SAVED") {
      importedSourceBinding.current = null;
      setVersion(result.version);
      setBindCurrentBrief(false);
      setScenes(cloneScenes(result.version.content.scenes));
      setReadState("ready");
      setNotice(`草稿版本 ${result.version.version_number} 已保存并精确读回；尚未人工确认。`);
    } else if (result.kind === "REJECTED") {
      setNeedsReload(result.status === 409);
      setNotice(
        result.status === 409
          ? "剧本修订冲突；草稿保留，请重新读取后核对。"
          : `草稿保存被拒绝（${result.status} / ${result.code}）；未宣称保存。`,
      );
    } else if (result.kind === "UNKNOWN") {
      setNotice("提交结果未知；已持久锁定原操作，不能自动再次发送。请只读核对。 ");
    } else setNotice(result.message);
  }

  if (!validScope)
    return (
      <section className="v2-story-card" role="status">
        <h1>分集剧本</h1>
        <p>请先选择真实项目和剧集，再编辑剧本。</p>
      </section>
    );

  const importControl = !version && scenes.length === 0 && projectId && (
    <AcceptedSourceSummarySeed
      key={`accepted-source/${projectId}/${episodeId}`}
      projectId={projectId}
      disabled={locked || dirty}
      onImport={(value) => {
        if (inFlight.current || leaveState.current.dirty || leaveState.current.version)
          return false;
        const scene = summaryStartingScene(value.summary);
        if (!scene) return false;
        importedSourceBinding.current = value.binding;
        setSourceBinding({ kind: "BOUND", binding: value.binding });
        setScenes([scene]);
        setSelectedSceneId(scene.scene_id);
        setChangeSummary("从已采纳来源摘要起稿，待人工改编");
        setNotice("已导入人工接纳的来源摘要，请改编后保存。来源版本与接纳记录保持固定。");
        return true;
      }}
    />
  );
  const metadata = (
    <>
      <h1>分集剧本</h1>
      <p>当前剧集：{episodeTitle ?? episodeId}</p>
      {episodeTitle && (
        <details>
          <summary>剧集标识</summary>
          <p>{episodeId}</p>
        </details>
      )}
      <p>
        {version
          ? `草稿版本 ${version.version_number} · 修订 ${version.head_revision}`
          : readState === "empty"
            ? "尚无持久剧本草稿"
            : "正在核对剧本状态"}
      </p>
      <p>保存产生新草稿版本；人工确认是另一步。</p>
      <p>
        此稿创作简报：
        {version
          ? (version.content.production_brief_version_id ?? "未绑定")
          : briefVersionId
            ? `保存新稿将绑定 ${briefVersionId}`
            : "未绑定；确认前需有真实上游版本"}
      </p>
      {version &&
        briefVersionId &&
        version.content.production_brief_version_id !== briefVersionId && (
          <label>
            <input
              type="checkbox"
              checked={bindCurrentBrief}
              disabled={locked}
              onChange={(event) => setBindCurrentBrief(event.target.checked)}
            />
            将当前创作简报绑定到下次保存的新版本
          </label>
        )}
      {!briefVersionId && !version?.content.production_brief_version_id && onOpenSource && (
        <Button onClick={onOpenSource}>补充原创灵感或来源</Button>
      )}
      <p>
        此稿已采纳来源：
        {version
          ? (version.content.source_extraction_version_id ?? "未绑定")
          : sourceBinding.kind === "BOUND"
            ? `保存新稿将绑定 ${sourceBinding.binding.sourceVersionId}`
            : sourceBinding.kind === "UNBOUND"
              ? "当前未绑定"
              : "状态待核实"}
      </p>
      {version?.content.source_proposal_acceptance_id && (
        <p>此稿接纳记录：{version.content.source_proposal_acceptance_id}</p>
      )}
      <Button
        disabled={!sourceGateway || busy || dirty || !!importedSourceBinding.current}
        onClick={() => void refreshSourceBinding()}
      >
        重新核对已采纳来源
      </Button>
    </>
  );
  const alerts = (
    <>
      {version && !confirmableContent && (
        <p role="status">
          确认需每场至少一段内容、对白呈现方式已明确，并绑定真实创作简报、故事版本或已采纳来源。
        </p>
      )}
      {unknownDelivery && (
        <p role="alert">
          旧稿对白呈现方式待补齐/未知。请逐段明确画内或画外，保存为新版本后再确认；旧版本与哈希保持原样。
        </p>
      )}
      {incompleteSourceBinding && (
        <p role="alert">旧稿来源版本与接纳记录不完整；须核对权威来源绑定，不能推断后确认。</p>
      )}
      {readState === "loading" && <p role="status">正在读取当前剧集剧本…</p>}
      {readState === "error" && <p role="alert">剧本状态无法核实，已暂停编辑与提交。</p>}
      {!gateway && <p role="alert">当前桌面版本缺少剧本接口。</p>}
      {!storage && <p role="alert">本地提交记录不可用，已阻止保存。</p>}
      {journal.kind === "PENDING" && <p role="alert">上次提交结果未知，禁止重复发送。</p>}
      {journal.kind === "BLOCKED" && <p role="alert">本地提交记录损坏，已阻止保存。</p>}
      {confirmationJournal.kind === "PENDING" && (
        <p role="alert">上次人工确认结果未知，禁止重复发送。</p>
      )}
      {confirmationJournal.kind === "BLOCKED" && <p role="alert">本地确认记录损坏，已阻止确认。</p>}
      {notice && <p role="status">{notice}</p>}
    </>
  );
  const outline = (
    <>
      <div className="v2-script-scene-list">
        {scenes.map((scene) => (
          <Button
            key={scene.scene_id}
            aria-pressed={selected?.scene_id === scene.scene_id}
            onClick={() => setSelectedSceneId(scene.scene_id)}
          >
            {String(scene.ordinal).padStart(2, "0")} · {scene.heading}
          </Button>
        ))}
        {readState === "empty" && <p>此剧集还没有场次。从添加场次开始。</p>}
      </div>
    </>
  );
  const addSceneControl = (
    <>
      <Button disabled={locked} onClick={addScene}>
        新增场次
      </Button>
    </>
  );
  const recovery = (
    <>
      <Button disabled={busy || dirty} onClick={() => void refresh(false)}>
        重新读取
      </Button>
      {dirty && (
        <Button disabled={busy} onClick={() => void refresh(true)}>
          舍弃草稿并读取
        </Button>
      )}
      {journal.kind === "PENDING" && inspectedPending && (
        <Button disabled={busy} onClick={finishPending}>
          结束未知记录
        </Button>
      )}
    </>
  );
  const confirmationControls = (
    <>
      {version && (
        <>
          <p>
            人工确认：
            {confirmationReadState === "loading"
              ? "读取中"
              : confirmationReadState === "error"
                ? "无法核实"
                : confirmation?.current &&
                    confirmation.confirmation?.version_id === version.version_id
                  ? `当前版本已确认 · ${confirmation.confirmation.confirmation_id}`
                  : confirmation?.confirmation
                    ? "旧版本曾确认；当前版本需重新确认"
                    : "当前版本未确认"}
          </p>
          {!confirmationGateway && <p role="alert">当前桌面版本缺少人工确认接口。</p>}
          <Button
            disabled={!confirmationGateway || busy}
            onClick={() => void refreshConfirmation()}
          >
            只读核对确认状态
          </Button>
          {confirmationJournal.kind === "PENDING" && inspectedConfirmation && (
            <Button disabled={busy} onClick={finishConfirmationPending}>
              结束未知确认记录
            </Button>
          )}
        </>
      )}
    </>
  );
  const sceneHeading = selected && (
    <>
      <label>
        场次标题
        <input
          value={selected.heading}
          disabled={locked}
          onChange={(event) => {
            const heading = event.currentTarget.value;
            updateScene(selected.scene_id, (scene) => ({ ...scene, heading }));
          }}
        />
      </label>
    </>
  );
  const blockActions = selected && (
    <>
      <Button disabled={locked} onClick={() => addBlock(selected.scene_id, "ACTION")}>
        添加动作
      </Button>
      <Button disabled={locked} onClick={() => addBlock(selected.scene_id, "DIALOGUE")}>
        添加对白
      </Button>
    </>
  );
  const sceneActions = selected && (
    <>
      {([-1, 1] as const).map((offset) => (
        <Button
          key={offset}
          disabled={
            locked || selected.ordinal + offset < 1 || selected.ordinal + offset > scenes.length
          }
          onClick={() =>
            setScenes((old) =>
              normalizeScenes(
                moveItem(
                  old,
                  old.findIndex((scene) => scene.scene_id === selected.scene_id),
                  offset,
                ),
              ),
            )
          }
        >
          {offset < 0 ? "上移此场" : "下移此场"}
        </Button>
      ))}
      <Button
        disabled={locked}
        onClick={() => {
          setScenes((old) =>
            normalizeScenes(old.filter((scene) => scene.scene_id !== selected.scene_id)),
          );
          setSelectedSceneId(null);
        }}
      >
        删除此场
      </Button>
    </>
  );
  const summaryControl = (
    <label>
      修改说明
      <input
        value={changeSummary}
        disabled={locked}
        onChange={(event) => setChangeSummary(event.target.value)}
      />
    </label>
  );
  const saveControl = (
    <Button
      primary
      disabled={!gateway || !storage || locked || !sourceReady || !dirty}
      onClick={() => void save()}
    >
      {busy ? "正在核对或保存…" : "保存草稿版本"}
    </Button>
  );
  const confirmControl = (
    <Button
      disabled={
        !confirmationGateway ||
        !version ||
        !confirmableContent ||
        dirty ||
        busy ||
        readState !== "ready" ||
        confirmationReadState !== "ready" ||
        !confirmation ||
        confirmation.current ||
        confirmation.latest_version_id !== version.version_id ||
        confirmation.latest_head_revision !== version.head_revision ||
        journal.kind !== "EMPTY" ||
        confirmationJournal.kind !== "EMPTY"
      }
      onClick={() => void confirmCurrentVersion()}
    >
      确认此剧本版本
    </Button>
  );
  const blockEditor = selected && (
    <ScriptSceneBlocks selected={selected} locked={locked} updateScene={updateScene} />
  );
  const sceneTitle = selected ? `场次 ${selected.ordinal} · ${selected.heading}` : "分集剧本";
  if (workspace)
    return (
      <ScriptWorkspaceView
        title={sceneTitle}
        sceneCount={scenes.length}
        blockCount={selected?.blocks.length ?? 0}
        hasScene={!!selected}
        outline={outline}
        addScene={addSceneControl}
        importControl={importControl}
        metadata={metadata}
        alerts={alerts}
        recovery={recovery}
        confirmation={confirmationControls}
        heading={sceneHeading}
        blocks={blockEditor}
        blockActions={blockActions}
        sceneActions={sceneActions}
        changeSummary={summaryControl}
        saveAction={saveControl}
        confirmAction={confirmControl}
        stateLabel={
          busy
            ? "正在处理…"
            : dirty
              ? "有未保存修改"
              : version
                ? `剧本草稿 v${version.version_number} · 已保存`
                : "尚未保存版本"
        }
      />
    );
  return (
    <div className="v2-script-body episode-script-editor" aria-label="分集剧本编辑器">
      <section className="v2-story-card v2-script-index">
        {metadata}
        {alerts}
        {outline}
        {addSceneControl}
        {recovery}
        {confirmationControls}
      </section>
      <section className="v2-story-card v2-script-paper">
        <h2>{selected ? `场次 ${selected.ordinal}` : "尚未选择场次"}</h2>
        {importControl}
        {sceneHeading}
        {blockEditor}
        {blockActions}
        {sceneActions}
        {summaryControl}
        {saveControl}
        {confirmControl}
        {projectId && episodeId && (
          <OfficialTextProposalPanel
            key={`${projectId}/${episodeId}`}
            projectId={projectId}
            episodeId={episodeId}
            base={
              version
                ? {
                    version_id: version.version_id,
                    content_hash: version.content_hash,
                    head_revision: version.head_revision,
                  }
                : null
            }
            disabled={locked || dirty || confirmationJournal.kind !== "EMPTY"}
            onBusyChange={(value) => {
              inFlight.current = value;
              setBusy(value);
            }}
            onAdopted={() => refresh(false)}
          />
        )}
        <p>确认只绑定当前精确版本；继续编辑并保存新草稿后，需重新人工确认。</p>
      </section>
    </div>
  );
}
