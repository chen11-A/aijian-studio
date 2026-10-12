import { visualJson } from "@aijian/contracts/visual-bible";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  settingsCommand,
  settingsIdentity,
  settingsReceipt,
  settingsReceiptMatches,
  settingsResponse,
  settingsWriteRejection,
} from "@aijian/contracts/project-settings";
import type {
  ProjectSettings,
  ProjectSettingsGateway,
  SettingsCommand,
} from "@aijian/contracts/project-settings";
import { ASSEMBLY_TIMEBASES } from "./adapters/assemblyEditing";
import { Button } from "./Common";

type Draft = { name: string; description: string; timebase: string };
type Pending = { projectId: string; command: SettingsCommand; hash: string };
const draftOf = (data: ProjectSettings): Draft => ({
  name: data.name,
  description: data.description,
  timebase: data.sequence_timebase ? visualJson(data.sequence_timebase) : "",
});
async function requestHash(projectId: string, command: SettingsCommand): Promise<string> {
  const bytes = new TextEncoder().encode(settingsIdentity(projectId, command));
  return `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
const journalKey = (p: string) => `aivora:project-settings:operation:v1:${p}`;
const same = (a: Draft, b: Draft) =>
  a.name === b.name && a.description === b.description && a.timebase === b.timebase;

export function ProjectSettingsEditor({
  projectId,
  gateway,
  onCurrent,
  setNavigationGuard,
  leave,
}: {
  projectId: string;
  gateway: ProjectSettingsGateway;
  onCurrent?: (current: ProjectSettings) => void;
  setNavigationGuard?: (guard: (() => boolean) | null) => void;
  leave?: () => void;
}) {
  const storage = useMemo(() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);
  const [current, setCurrent] = useState<ProjectSettings | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", description: "", timebase: "" });
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(!storage);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const flight = useRef(false);
  const journalBad = useRef(false);
  const recovered = useRef<Pending | null>(null);
  const verified = useRef<ProjectSettings | null>(null);
  const live = useRef({ projectId, draft, current, onCurrent });
  live.current = { projectId, draft, current, onCurrent };
  const dirty = !!current && !same(draft, draftOf(current));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  function pendingIsDurable() {
    const item = pendingRef.current;
    try {
      return (
        !!item &&
        !!storage &&
        item.projectId === live.current.projectId &&
        storage.getItem(journalKey(item.projectId)) === JSON.stringify(item)
      );
    } catch {
      return false;
    }
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!flight.current && (!pendingRef.current ? !dirtyRef.current : pendingIsDurable())) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    const guard = () => {
      if (flight.current || (pendingRef.current ? !pendingIsDurable() : dirtyRef.current)) {
        setNotice(
          flight.current
            ? "正在核对设置，请等待操作结束。"
            : "项目设置尚未保存；请保存或取消草稿后切换。",
        );
        return false;
      }
      return true;
    };
    setNavigationGuard?.(guard);
    return () => setNavigationGuard?.(null);
  }, [setNavigationGuard]);

  function accept(data: ProjectSettings, replaceDraft: boolean) {
    verified.current = data;
    setCurrent(data);
    if (replaceDraft) setDraft(draftOf(data));
    live.current.onCurrent?.(data);
  }
  function consistent(data: ProjectSettings) {
    const prior = verified.current;
    return (
      !prior ||
      prior.project_id !== data.project_id ||
      data.revision > prior.revision ||
      (data.revision === prior.revision && visualJson(data) === visualJson(prior))
    );
  }
  async function load() {
    if (flight.current) return;
    const request = ++epoch.current;
    flight.current = true;
    setBusy(true);
    try {
      const result = await gateway.getProjectSettings(projectId);
      if (epoch.current !== request || live.current.projectId !== projectId) return;
      if (
        result.kind !== "FOUND" ||
        !settingsResponse(result.receipt, projectId) ||
        !consistent(result.receipt.data)
      ) {
        setBlocked(true);
        setNotice("项目设置无法核实；草稿保留，保存已暂停。");
        return;
      }
      accept(result.receipt.data, !dirtyRef.current);
      if (recovered.current && !dirtyRef.current) {
        const c = recovered.current.command.changes;
        setDraft(draftOf({ ...result.receipt.data, ...c } as ProjectSettings));
      }
      setBlocked(!storage || journalBad.current);
      setNotice(
        dirtyRef.current
          ? "已读回当前修订，保留未保存草稿；请核对后保存。"
          : "已读取本地项目设置。",
      );
    } catch {
      if (epoch.current === request) {
        setBlocked(true);
        setNotice("读取失败；未填入演示默认值。");
      }
    } finally {
      if (epoch.current === request) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    const scope = ++epoch.current;
    flight.current = false;
    setCurrent(null);
    setDraft({ name: "", description: "", timebase: "" });
    setPending(null);
    journalBad.current = false;
    recovered.current = null;
    verified.current = null;
    setBlocked(!storage);
    void (async () => {
      try {
        const raw = storage?.getItem(journalKey(projectId));
        if (raw) {
          const saved: unknown = JSON.parse(raw);
          if (
            !saved ||
            typeof saved !== "object" ||
            Array.isArray(saved) ||
            Object.keys(saved).sort().join(",") !== "command,hash,projectId"
          )
            throw new Error("Invalid journal");
          const item = saved as Pending;
          if (
            item.projectId !== projectId ||
            !settingsCommand(item.command) ||
            item.hash !== (await requestHash(projectId, item.command))
          )
            throw new Error("Invalid journal binding");
          if (epoch.current !== scope) return;
          recovered.current = item;
          setPending(item);
        }
        if (epoch.current === scope) await load();
      } catch {
        if (epoch.current === scope) {
          journalBad.current = true;
          setBlocked(true);
          setNotice("本地操作记录无法核实，已阻止保存。");
        }
      }
    })();
    return () => {
      epoch.current += 1;
      flight.current = false;
    };
  }, [projectId, gateway, storage]);

  function closeJournal(item: Pending) {
    if (!storage || storage.getItem(journalKey(projectId)) !== JSON.stringify(item)) {
      journalBad.current = true;
      throw new Error("Pending operation journal changed");
    }
    storage.removeItem(journalKey(projectId));
    if (storage.getItem(journalKey(projectId)) !== null) {
      journalBad.current = true;
      throw new Error("Pending operation journal was not removed");
    }
    journalBad.current = false;
  }
  async function confirm(item: Pending, generation: number): Promise<boolean> {
    const result = await gateway.getProjectSettingsReceipt(projectId, item.command.operation_id);
    if (
      result.kind !== "FOUND" ||
      !settingsReceipt(result.receipt, projectId, item.command.operation_id) ||
      !settingsReceiptMatches(result.receipt, item.command, item.hash)
    )
      return false;
    if (epoch.current !== generation || live.current.projectId !== projectId) return false;
    closeJournal(item);
    setPending(null);
    recovered.current = null;
    const historical = result.receipt.data.result;
    if (!verified.current || historical.revision > verified.current.revision)
      verified.current = historical;
    // This is the historical operation result, not an implicit replacement of a newer revision.
    const latest = await gateway.getProjectSettings(projectId);
    if (epoch.current !== generation || live.current.projectId !== projectId) return false;
    if (
      latest.kind !== "FOUND" ||
      !settingsResponse(latest.receipt, projectId) ||
      latest.receipt.data.revision < result.receipt.data.result_revision ||
      !consistent(latest.receipt.data) ||
      (latest.receipt.data.revision === result.receipt.data.result_revision &&
        visualJson(latest.receipt.data) !== visualJson(historical))
    ) {
      setBlocked(true);
      setNotice("原操作已由精确回执确认；当前设置读取失败，草稿保留，请重新读取。");
      return true;
    }
    accept(latest.receipt.data, true);
    setBlocked(false);
    setNotice(
      latest.receipt.data.revision === result.receipt.data.result_revision
        ? "项目设置已保存，精确操作回执与当前修订均已读回。"
        : "原操作已确认；当前设置已有后续修订，已显示最新值。",
    );
    return true;
  }
  async function check() {
    if (!pending || flight.current || !storage) return;
    const generation = ++epoch.current;
    flight.current = true;
    setBusy(true);
    try {
      if (!(await confirm(pending, generation)) && epoch.current === generation)
        setNotice("尚未找到匹配的已提交回执；原操作继续锁定，不会重新发送。");
    } catch {
      if (epoch.current === generation) setNotice("回执核对失败；原操作继续锁定，不会重新发送。");
    } finally {
      if (epoch.current === generation) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  async function save() {
    if (!current || !storage || pending || blocked || flight.current || !dirty) return;
    const command: SettingsCommand = {
      operation_id: `pso_${crypto.randomUUID().replaceAll("-", "")}`,
      expected_project_revision: current.revision,
      changes: {
        name: draft.name.trim(),
        description: draft.description.replaceAll("\r\n", "\n"),
        sequence_timebase: draft.timebase ? JSON.parse(draft.timebase) : null,
      },
    };
    if (!settingsCommand(command)) {
      setNotice("名称需为1–80字，说明最多4000字；仅允许普通文字和说明换行，请核对时基。");
      return;
    }
    const generation = ++epoch.current;
    flight.current = true;
    setBusy(true);
    let sent = false;
    try {
      if (storage.getItem(journalKey(projectId)) !== null) {
        journalBad.current = true;
        throw new Error("Existing operation must be resolved");
      }
      const item: Pending = { projectId, command, hash: await requestHash(projectId, command) };
      if (epoch.current !== generation) return;
      storage.setItem(journalKey(projectId), JSON.stringify(item));
      if (storage.getItem(journalKey(projectId)) !== JSON.stringify(item))
        throw new Error("Journal not durable");
      setPending(item);
      recovered.current = item;
      sent = true;
      const result = await gateway.updateProjectSettings(projectId, command);
      if (epoch.current !== generation || live.current.projectId !== projectId) return;
      if (settingsWriteRejection(result)) {
        closeJournal(item);
        setPending(null);
        recovered.current = null;
        setBlocked(true);
        setNotice(`保存被拒绝（${result.code}）；草稿保留，请重新读取当前修订。`);
        return;
      }
      if (
        result.kind !== "FOUND" ||
        !settingsReceipt(result.receipt, projectId, command.operation_id) ||
        !settingsReceiptMatches(result.receipt, command, item.hash) ||
        !(await confirm(item, generation))
      ) {
        if (epoch.current !== generation) return;
        setNotice("保存结果未知；原操作已锁定，请只读核对回执，不会自动重发。");
      }
    } catch {
      if (epoch.current !== generation) return;
      setBlocked(!sent || journalBad.current);
      setNotice(
        sent
          ? "保存结果未知；原操作已锁定，不会自动重发。"
          : "本地操作记录不可用，未发送保存请求。",
      );
    } finally {
      if (epoch.current === generation) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  const locked = busy || !!pending || !current;
  return (
    <div className="v2-utility-page v2-settings-page v2-project-settings">
      <header className="page-title">
        <div>
          <h1>项目设置</h1>
          <p>{current ? `《${current.name}》 · 修订 ${current.revision}` : "读取本地项目设置"}</p>
        </div>
        <Button disabled={busy || (dirty && !pending)} onClick={leave}>
          返回项目
        </Button>
      </header>
      <div className="v2-settings-body v2-project-settings-editor-body">
        <section className="v2-utility-card v2-project-settings-card">
          <h2>项目基础设置</h2>
          <div className="v2-project-settings-fields">
            <label>
              项目名称
              <input
                value={draft.name}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              项目说明
              <textarea
                value={draft.description}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label>
              项目默认时基
              <select
                value={draft.timebase}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, timebase: e.target.value })}
              >
                <option value="">未指定</option>
                {ASSEMBLY_TIMEBASES.map((t) => (
                  <option key={t.label} value={visualJson(t.value)}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              画幅（创建时确定）
              <input readOnly value={current?.aspect_ratio ?? "待读取"} />
            </label>
            <label>
              目标时长（创建时确定）
              <input
                readOnly
                value={current ? `${current.target_duration_seconds} 秒` : "待读取"}
              />
            </label>
            <label>
              来源语言（创建时确定）
              <input readOnly value={current ? "简体中文" : "待读取"} />
            </label>
          </div>
          <p>
            默认时基可在空装配中显式选用；已有镜头、音频、字幕和装配版本保留各自时基。制作意图与整部、单集时长请在创作简报编辑；归档与恢复请在项目中心管理。
          </p>
          <p>项目级生成、第三方发送及版本策略尚无可编辑持久合同；预算意向与费用账本分别核对。</p>
        </section>
        <section className="v2-utility-card" aria-label="项目设置状态">
          {busy && <p role="status">正在读取或保存项目设置…</p>}
          {pending && (
            <p role="alert">原操作 {pending.command.operation_id} 待精确核对，保存已锁定。</p>
          )}
          {blocked && <p role="alert">当前状态或本地操作记录无法核实，保存已暂停。</p>}
          <p role="status">{notice}</p>
          <Button disabled={busy} onClick={() => void load()}>
            重新读取项目
          </Button>
          {pending && (
            <Button disabled={busy} onClick={() => void check()}>
              只读核对原操作回执
            </Button>
          )}
          <Button
            disabled={locked || !dirty}
            onClick={() => {
              if (current) setDraft(draftOf(current));
            }}
          >
            取消未保存草稿
          </Button>
          <Button
            primary
            disabled={locked || blocked || !dirty || !storage}
            onClick={() => void save()}
          >
            保存项目设置
          </Button>
        </section>
      </div>
    </div>
  );
}
