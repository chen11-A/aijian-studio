import { useState } from "react";
import { ExportCheck } from "./ExportCheck";
import type { QcReport } from "./qcReport";
import { StoryFrame } from "./stories/StoryFrame";
import { SAMPLE_QC_REPORT, sampleShotSpans } from "./stories/sampleData";

/** Example page with a made-up report in the packages/aivora-qc format. */
const STATES = [
  { id: "issues", label: "有问题" },
  { id: "checking", label: "检查中" },
  { id: "clean", label: "没问题" },
  { id: "error", label: "没检查完" },
  { id: "invalid", label: "结果读不出" },
];

const CLEAN: QcReport = { ...SAMPLE_QC_REPORT, issues: [] };

/** Not a version 1 report, to show what happens when the JSON cannot be read. */
const UNREADABLE = { schemaVersion: 2, issues: [] };

function reportFor(state: string): unknown {
  if (state === "clean") return CLEAN;
  if (state === "invalid") return UNREADABLE;
  if (state === "checking" || state === "error") return null;
  return SAMPLE_QC_REPORT;
}

export function ExportCheckStory({ state = "issues" }: { state?: string }) {
  const [log, setLog] = useState<string>();
  return (
    <StoryFrame story="export-check" states={STATES} state={state} log={log}>
      <ExportCheck
        report={reportFor(state)}
        checking={state === "checking"}
        error={state === "error" ? "没有找到 ffmpeg 或 ffprobe，这次没有检查。" : null}
        shots={sampleShotSpans()}
        fileName="雨夜旧书店-第1集.mp4"
        onFix={(issue) => setLog(`去修 ${issue.id}（${issue.action}）`)}
        onExport={() => setLog("直接导出")}
      />
    </StoryFrame>
  );
}
