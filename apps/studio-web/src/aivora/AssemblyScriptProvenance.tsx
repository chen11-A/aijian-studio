import { useEffect } from "react";
import { assemblyScriptSources } from "@aijian/contracts/assembly-script-provenance";
import { Button } from "./Common";
import type { AssemblyContent, AssemblyVersion } from "./adapters/episodeMediaAssembly";
import type { AssemblyScriptGateway } from "./useAssemblyScriptSources";
import { useConfirmedAssemblyScript } from "./useConfirmedAssemblyScript";

/** Adopt source authority as an ordinary assembly edit; never approve/execute audio. */
export function AssemblyScriptProvenance({
  content,
  savedVersion,
  locked,
  onEdit,
  onSaveBlocked,
  gateway,
}: {
  content: AssemblyContent;
  savedVersion: AssemblyVersion | null;
  locked: boolean;
  onEdit(next: AssemblyContent): boolean;
  onSaveBlocked(blocked: boolean): void;
  gateway?: AssemblyScriptGateway;
}) {
  const { source, status, refresh } = useConfirmedAssemblyScript(
    content.project_id,
    content.episode_id,
    gateway,
  );
  const sources = assemblyScriptSources(content);
  const confirmation = status?.confirmation;
  const pin = content.script_provenance;
  const allMatch =
    !!confirmation &&
    !!sources.length &&
    sources.every((s) => s.versionId === confirmation.version_id) &&
    content.subtitle_segments.every(
      (s) =>
        !("text" in s) ||
        !s.script_ref ||
        s.script_ref.script_content_hash === confirmation.content_hash,
    );
  const current =
    pin?.mode === "CONFIRMED" &&
    !!confirmation &&
    allMatch &&
    pin.script_version_id === confirmation.version_id &&
    pin.script_content_hash === confirmation.content_hash;
  const blocked = pin?.mode === "CONFIRMED" && (source.state !== "ready" || !current);
  useEffect(() => onSaveBlocked(blocked), [blocked, onSaveBlocked]);
  useEffect(() => () => onSaveBlocked(false), [onSaveBlocked]);
  const saved = savedVersion?.script_source_status;
  return (
    <details className="assembly-dialogue-editor" open aria-label="声音字幕剧本来源核对">
      <summary>声音与字幕 · 剧本确认来源</summary>
      <div className="assembly-dialogue-body">
        <p>
          对白 {sources.filter((s) => s.kind === "DIALOGUE").length} 段 · 剧本字幕{" "}
          {sources.filter((s) => s.kind === "SUBTITLE").length}{" "}
          条。确认只证明文本来源；录音授权、试听、口型与正式签发需另行验收。
        </p>
        {pin?.mode === "CONFIRMED" ? (
          <p>
            装配固定确认：{pin.confirmation_id} · {pin.script_version_id} ·{" "}
            {pin.script_content_hash}
          </p>
        ) : (
          <p>当前为未确认 草稿 来源，不计为声音或成片批准。</p>
        )}
        {saved && (
          <p>
            保存版本来源：{saved.state} · 对白 {saved.dialogue_segment_ids.join("、") || "无"} ·
            字幕 {saved.subtitle_segment_ids.join("、") || "无"}
          </p>
        )}
        <Button disabled={locked || source.state === "loading"} onClick={refresh}>
          核对最新人工确认
        </Button>
        {source.state === "loading" && <p role="status">正在核对本集确认及精确剧本…</p>}
        {source.state === "error" && (
          <p role="status">确认来源未可靠读回。已保存 pin 和未保存编辑保留；不能采用或清除确认。</p>
        )}
        {source.state === "empty" && <p>本集尚无人工确认。先在剧本页面保存并明确确认文本。</p>}
        {confirmation && source.state === "ready" && (
          <>
            <p>
              最近确认：{confirmation.version_id} · {confirmation.content_hash}
            </p>
            {status?.latest_version_id !== confirmation.version_id && (
              <p role="status">已有未确认的新草稿；已确认来源继续有效，不自动换版。</p>
            )}
            {pin?.mode === "CONFIRMED" && !current && (
              <p role="alert">
                确认来源已替换或片段尚未对齐；保存和新导出会拒绝。请逐段核对录音／字幕、显式改绑，再采用新确认。
              </p>
            )}
            {!allMatch && sources.length > 0 && (
              <ul aria-label="待核对声音字幕片段">
                {sources
                  .filter((s) => s.versionId !== confirmation.version_id)
                  .map((s) => (
                    <li key={s.segmentId}>
                      {s.kind} · {s.segmentId} · {s.versionId}
                    </li>
                  ))}
              </ul>
            )}
            <Button
              disabled={locked || !allMatch || current}
              onClick={() => {
                if (
                  !locked &&
                  allMatch &&
                  window.confirm(
                    "采用这一人工确认作为所列对白和字幕的文本来源？这只修改装配草稿，需另行保存；不代表声音授权、试听或成片签发。",
                  )
                )
                  onEdit({
                    ...content,
                    script_provenance: {
                      mode: "CONFIRMED",
                      confirmation_id: confirmation.confirmation_id,
                      script_version_id: confirmation.version_id,
                      script_content_hash: confirmation.content_hash,
                    },
                  });
              }}
            >
              采用此已确认剧本来源
            </Button>
            {pin?.mode === "CONFIRMED" && (
              <Button
                disabled={locked}
                onClick={() => {
                  if (
                    !locked &&
                    window.confirm(
                      "明确转回未确认 草稿 来源？现有片段与历史版本保留，后续保存不再计为已确认来源；需另行保存。",
                    )
                  )
                    onEdit({ ...content, script_provenance: { mode: "DRAFT" } });
                }}
              >
                转回未确认 草稿 来源
              </Button>
            )}
          </>
        )}
        <p>
          来源采用／改绑可撤销。保存使用同一本集装配版本；UNKNOWN
          只能重新读取核对，确认来源核对不会重发保存。
        </p>
      </div>
    </details>
  );
}
