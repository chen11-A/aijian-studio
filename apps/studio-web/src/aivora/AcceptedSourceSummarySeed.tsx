import { useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import { Button } from "./Common";
import {
  readAcceptedSummary,
  sameAcceptedSummary,
  type AcceptedSummary,
  type SummaryGateway,
} from "./adapters/acceptedSourceSummary";

export function AcceptedSourceSummarySeed({
  projectId,
  disabled,
  onImport,
}: {
  projectId: string;
  disabled: boolean;
  onImport: (value: AcceptedSummary) => boolean;
}) {
  const transport = useMemo(createStudioTransport, []);
  const gateway =
    transport.getSourceExtraction && transport.getSourceProposalAcceptanceForVersion
      ? (transport as SummaryGateway)
      : null;
  const [preview, setPreview] = useState<AcceptedSummary | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const active = useRef(false);
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [projectId],
  );

  async function read(importReviewed: boolean) {
    if (!gateway || disabled || active.current || (importReviewed && !preview)) return;
    active.current = true;
    setBusy(true);
    const request = ++epoch.current;
    const result = await readAcceptedSummary(gateway, projectId);
    if (epoch.current !== request) return;
    active.current = false;
    setBusy(false);
    if (result.kind !== "FOUND") {
      setPreview(null);
      setNotice(
        result.kind === "EMPTY"
          ? "还没有人工接纳的来源摘要。请先在故事页核对并接纳真实提案。"
          : "无法核实摘要与接纳记录，未导入内容，请重新读取。",
      );
      return;
    }
    setPreview(result.value);
    if (importReviewed && preview && sameAcceptedSummary(preview, result.value)) {
      setNotice(
        onImport(result.value)
          ? "摘要已放入可编辑起稿，尚未保存。请改编内容后保存剧本。"
          : "剧本状态已变化，未覆盖任何内容。请重新核对当前草稿。",
      );
    } else
      setNotice(
        importReviewed
          ? "摘要版本或接纳记录已变化，未导入。请核对新摘要后再操作。"
          : "已读取人工接纳的摘要。导入仅填入当前空白起稿，不会再次调用 AI。",
      );
  }

  return (
    <section aria-label="已采纳摘要起稿">
      <h3>从已采纳摘要开始</h3>
      <p>可将真实提取摘要放入空白剧本继续改编。摘要仍是起稿材料，需要你补充场次、动作和对白。</p>
      <Button disabled={!gateway || disabled || busy} onClick={() => void read(false)}>
        {busy ? "正在核对摘要…" : "读取已采纳摘要"}
      </Button>
      {preview && (
        <>
          <p>{preview.summary}</p>
          <small>来源版本：{preview.binding.sourceVersionId}</small>
          <Button disabled={disabled || busy} onClick={() => void read(true)}>
            导入摘要为可编辑起稿
          </Button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
