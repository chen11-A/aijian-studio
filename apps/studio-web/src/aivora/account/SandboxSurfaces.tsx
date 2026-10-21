import { useState } from "react";
import { Button } from "../Common";
import { CurrentModelLink } from "./CurrentModelLink";
import {
  sandboxCancel,
  sandboxMarkFailed,
  sandboxMarkUnknown,
  sandboxQuery,
  sandboxSubmit,
  sandboxVoiceResult,
  type SandboxMediaTask,
} from "./sandbox-task";
import "./surfaces.css";

export function SandboxMediaTaskDesk() {
  const [task, setTask] = useState<SandboxMediaTask | null>(null);
  const busy =
    task?.status === "queued" || task?.status === "running" || task?.status === "unknown";
  return (
    <section className="v2-utility-card sandbox-desk" aria-label="媒体任务沙箱">
      <h2>媒体任务</h2>
      <p>
        提交、查询、取消和候选都在本地沙箱里走完。不访问供应商，不预留预算，不派发，不下载文件，不产生费用。
      </p>
      <CurrentModelLink capability="VIDEO" />
      <p role="status">
        状态：{task?.status ?? "idle"}
        {task?.id ? ` · ${task.id}` : ""}
      </p>
      {task?.note && <p>{task.note}</p>}
      <div className="sandbox-actions">
        <Button
          primary
          disabled={busy}
          onClick={() => setTask((current) => sandboxSubmit(current, `sandbox-${Date.now()}`))}
        >
          沙箱提交
        </Button>
        <Button disabled={!task} onClick={() => setTask((current) => sandboxQuery(current))}>
          沙箱查询
        </Button>
        <Button disabled={!task} onClick={() => setTask((current) => sandboxCancel(current))}>
          沙箱取消
        </Button>
        <Button disabled={!task} onClick={() => setTask((current) => sandboxMarkFailed(current))}>
          沙箱标记失败
        </Button>
        <Button disabled={!task} onClick={() => setTask((current) => sandboxMarkUnknown(current))}>
          沙箱标记未知
        </Button>
      </div>
    </section>
  );
}

export function SandboxVoicePlan() {
  const [line, setLine] = useState("");
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <section className="v2-utility-card sandbox-desk" aria-label="配音方案沙箱">
      <h2>配音方案</h2>
      <p>声线、试听和生成先在沙箱里走通。没有音频文件，不做口型，也不计费。</p>
      <CurrentModelLink capability="SPEECH" />
      <label>
        对白
        <textarea
          aria-label="配音对白"
          value={line}
          maxLength={2000}
          onChange={(event) => setLine(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        我确认这段声线只用于当前作品的沙箱预览，不代表已获得克隆或商用授权
      </label>
      <div className="sandbox-actions">
        <Button
          onClick={() => setNotice(sandboxVoiceResult({ line, consent, action: "audition" }))}
        >
          沙箱试听
        </Button>
        <Button
          primary
          onClick={() => setNotice(sandboxVoiceResult({ line, consent, action: "generate" }))}
        >
          沙箱生成配音
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export function FormalDeliveryChecklist() {
  const items = [
    ["DRAFT 草稿导出", "下方草稿面板可以导出本地草稿，草稿不是正式母版。"],
    ["画幅、帧率、编码和声音预检", "正式规格仍待与已保存装配逐项核对。"],
    ["权利与肖像、声线授权", "未清权不能签发。沙箱不代替权利审核。"],
    ["取消、失败重试和打开成片", "正式导出链还没有可取消的上游任务。"],
    ["Picture Lock 与正式 MP4", "未完成。不能把 DRAFT 文件当成正式成片。"],
  ];
  return (
    <section className="v2-utility-card delivery-checklist" aria-label="正式交付清单">
      <h2>正式交付清单</h2>
      <p>这些是成片交付还要经过的检查。当前每一项都还没完成。</p>
      <ul>
        {items.map(([title, detail]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span> · 未完成 · {detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChangeCostNotice({ onOpenCosts }: { onOpenCosts: () => void }) {
  return (
    <section className="v2-utility-card delivery-checklist" aria-label="修改费用提示">
      <h2>修改费用</h2>
      <p>这次修改的费用是未知。未知不是 0，沙箱也不会估算一个金额，更不会写入预算或预留额度。</p>
      <div className="sandbox-actions">
        <Button onClick={onOpenCosts}>查看作品用量</Button>
      </div>
    </section>
  );
}
