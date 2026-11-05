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
    <section className="v2-utility-card sandbox-desk" aria-label="生成任务演示">
      <h2>媒体任务</h2>
      <p>这里的按钮只在这台电脑上演示，不会真的生成，也不花钱，不预留预算。</p>
      <CurrentModelLink capability="VIDEO" />
      <p role="status">
        状态：{task?.status ?? "还没有提交"}
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
    <section className="v2-utility-card sandbox-desk" aria-label="配音演示">
      <h2>配音方案</h2>
      <div className="sandbox-body">
        <p>这里先演示怎么选声音、试听和生成配音：不会真的出声音，不对口型，也不花钱。</p>
        <details>
          <summary>声音和成片怎么配合</summary>
          <p>
            声音页和成片用的是同一个剪辑版本。可以选电脑上的录音，配到剧本里的某一句台词上，再剪短或另存一版。声音授权、生成配音、核对台词和对口型都还没接上。
            配上去不代表录音里说的就是这句台词。
          </p>
        </details>
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
          我确认这个声音只在这部作品的演示里用，这不代表可以拿去仿制或商用
        </label>
      </div>
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
    ["试做版成片", "可以先导出一版试做版看看，发布前还要再检查。"],
    ["画面和声音检查", "画幅、帧率和声音还要和已保存的成片逐项核对。"],
    ["肖像和声音授权", "没有确认授权，不能发布。"],
    ["失败后的处理", "取消、重试和打开成片还没有接到真实任务。"],
    ["正式成片", "未完成。草稿文件不能当作正式成片。"],
  ];
  return (
    <section className="v2-utility-card delivery-checklist" aria-label="发布前要做的检查">
      <h2>发布前要做的检查</h2>
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
      <p>这次修改要花多少还不知道。没记下的费用不等于 0，这里也不替你估价。</p>
      <div className="sandbox-actions">
        <Button onClick={onOpenCosts}>查看作品用量</Button>
      </div>
    </section>
  );
}
