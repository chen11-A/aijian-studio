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
        提交、查询和取消都只发生在这台电脑上。不访问供应商，不下载文件，不产生费用，也不预留预算或派发任务。
      </p>
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
    <section className="v2-utility-card sandbox-desk" aria-label="配音方案沙箱">
      <h2>配音方案</h2>
      <div className="sandbox-body">
        <p>声线、试听和生成先在沙箱里走通。没有音频文件，不做口型，也不计费。</p>
        <details>
          <summary>声音和成片怎么配合</summary>
          <p>
            声音页与成片组装使用同一本集剪辑版本。选择真实本地录音，可绑定保存剧本的对白、裁剪与另存版本。声线授权、语音生成、对白内容核验和口型同步尚未接通。草稿
            绑定不证明录音说出了该句对白。
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
          我确认这段声线只用于当前作品的沙箱预览，不代表已获得克隆或商用授权
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
    ["草稿成片", "可以先导出一版草稿，这还不是正式发行的成片。"],
    ["画面和声音检查", "画幅、帧率和声音还要和已保存的成片逐项核对。"],
    ["肖像和声音授权", "没有确认授权，不能当作正式发行。"],
    ["失败后的处理", "取消、重试和打开成片还没有接到真实任务。"],
    ["正式成片", "未完成。草稿文件不能当作正式成片。"],
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
      <p>这次修改要花多少还不知道。没有记下来的金额不能当成 0，这里也不会估一个价。</p>
      <div className="sandbox-actions">
        <Button onClick={onOpenCosts}>查看作品用量</Button>
      </div>
    </section>
  );
}
