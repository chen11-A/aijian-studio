import { useState } from "react";
import { Button } from "./Common";
import { bindAssemblyDialogue } from "./adapters/assemblyDialogue";
import type { AssemblyContent } from "./adapters/episodeMediaAssembly";
import { useAssemblyScriptSources, type AssemblyScriptGateway } from "./useAssemblyScriptSources";

/** Binds imported audio to one immutable saved script block; no voice generation. */
export function AssemblyDialogueAudioEditor({
  content,
  selectedId,
  locked,
  onEdit,
  gateway,
}: {
  content: AssemblyContent;
  selectedId: string;
  locked: boolean;
  onEdit: (next: AssemblyContent) => boolean;
  gateway?: AssemblyScriptGateway;
}) {
  const segment = content.audio_segments.find((item) => item.segment_id === selectedId);
  const bound = segment?.track_kind === "DIALOGUE" ? segment : undefined;
  const { latest, pinned, refresh } = useAssemblyScriptSources(
    content.project_id,
    content.episode_id,
    bound?.script_version_id ?? undefined,
    gateway,
  );
  const choiceKey = `${content.project_id}/${content.episode_id}/${selectedId}/${latest.version?.version_id ?? ""}`;
  const [choice, setChoice] = useState({ key: "", blockId: "" });
  const blockId =
    choice.key === choiceKey
      ? choice.blockId
      : latest.dialogues.some((item) => item.block.block_id === bound?.script_block_id)
        ? (bound!.script_block_id ?? "")
        : "";
  const candidate = latest.dialogues.find((item) => item.block.block_id === blockId);
  const fixed = pinned.dialogues.find((item) => item.block.block_id === bound?.script_block_id);
  const sourceUnavailable =
    !!bound &&
    (!fixed || fixed.speakerId !== bound.speaker_id || fixed.block.delivery !== bound.delivery);
  const unchanged =
    bound?.script_version_id === latest.version?.version_id &&
    bound?.script_block_id === blockId &&
    !!candidate &&
    bound?.speaker_id === candidate.speakerId &&
    bound?.delivery === candidate.block.delivery;
  const newer =
    !!bound && !!latest.version && latest.version.version_id !== bound.script_version_id;
  function bind() {
    if (locked || !segment || !candidate || !latest.version || sourceUnavailable || unchanged)
      return;
    const delivery = candidate.block.delivery;
    if (delivery !== "ON_SCREEN" && delivery !== "OFF_SCREEN") return;
    if (
      bound &&
      !window.confirm(
        `将所选音频从剧本 ${bound.script_version_id} / ${bound.script_block_id} 改绑到剧本 v${latest.version.version_number}「${candidate.block.speaker}」的对白？素材、音频裁剪和旧保存版本保留，此修改可撤销。`,
      )
    )
      return;
    onEdit(
      bindAssemblyDialogue(content, segment.segment_id, {
        script_version_id: latest.version.version_id,
        script_block_id: candidate.block.block_id,
        speaker_id: candidate.speakerId,
        delivery,
      }),
    );
  }
  return (
    <details className="assembly-dialogue-editor" aria-label="导入音频对白绑定">
      <summary>
        对白轨 · {content.audio_segments.filter((item) => item.track_kind === "DIALOGUE").length}{" "}
        个片段已绑定剧本
      </summary>
      <div className="assembly-dialogue-body">
        <header className="assembly-actions">
          <h3>对白来源 · 导入音频</h3>
          <Button disabled={locked || latest.state === "loading"} onClick={refresh}>
            核对已保存剧本
          </Button>
        </header>
        {!segment ? (
          <p>先加入并选择一个已导入音频片段，再绑定本集已保存剧本中的对白。</p>
        ) : (
          <>
            <p>
              所选音频：{segment.segment_id} · 素材版本 {segment.media.asset_version_id}
            </p>
            {bound ? (
              <>
                <p>
                  固定对白：{bound.script_version_id} / {bound.script_block_id}
                </p>
                <p>
                  说话者 {bound.speaker_id} ·{" "}
                  {bound.delivery === "OFF_SCREEN" ? "画外音" : "画内对白"}
                </p>
                {fixed && (
                  <p>
                    剧本 v{pinned.version?.version_number} · {fixed.scene.heading} ·{" "}
                    {fixed.block.speaker}：{fixed.block.text}
                  </p>
                )}
                {sourceUnavailable && (
                  <p role="status">
                    固定对白尚未可靠读回或身份不符，现有绑定已保留；暂不能改绑，请重试核对。
                  </p>
                )}
                {newer && (
                  <p role="status" className="assembly-notice">
                    {latest.dialogues.some((item) => item.block.block_id === bound.script_block_id)
                      ? "剧本已有新版本，请核对对白、说话者和呈现方式。当前绑定不会自动更新。"
                      : "最新剧本已没有此可绑定对白段落，原版本绑定仍保留。"}
                  </p>
                )}
              </>
            ) : (
              <p>
                当前为 {segment.track_kind}；绑定后成为 DIALOGUE
                对白轨，保存时由本地项目核验剧本引用。
              </p>
            )}
            {latest.state === "loading" && <p role="status">正在读取本集已保存剧本…</p>}
            {latest.state === "error" && (
              <p role="status">已保存剧本读取未完成。可重试核对；现有音频和绑定保持不变。</p>
            )}
            {latest.state === "empty" && (
              <p>本集还没有已保存剧本。先到「剧本」保存真实对白，再回来绑定。</p>
            )}
            {latest.version && (
              <>
                <label>
                  本集已保存剧本对白
                  <select
                    value={blockId}
                    disabled={locked || sourceUnavailable}
                    onChange={(event) => setChoice({ key: choiceKey, blockId: event.target.value })}
                  >
                    <option value="">选择对白 · 剧本 v{latest.version.version_number}</option>
                    {latest.dialogues.map((item) => (
                      <option key={item.block.block_id} value={item.block.block_id}>
                        {item.scene.ordinal}.{item.block.ordinal} {item.block.speaker} ·{" "}
                        {item.block.delivery === "OFF_SCREEN" ? "画外音" : "画内对白"} ·{" "}
                        {item.block.text.slice(0, 80)}
                      </option>
                    ))}
                  </select>
                </label>
                {!latest.dialogues.length && (
                  <p>
                    这个保存版本没有带明确呈现方式的对白。请先在剧本中保存说话者与画内对白或画外音。
                  </p>
                )}
                {candidate && (
                  <p>
                    {candidate.scene.heading} · {candidate.block.speaker}：{candidate.block.text}
                  </p>
                )}
                <Button
                  disabled={locked || !candidate || sourceUnavailable || unchanged}
                  onClick={bind}
                >
                  {bound ? "将所选音频改绑到此对白" : "绑定所选音频为对白轨"}
                </Button>
              </>
            )}
            {bound && (
              <Button
                disabled={locked}
                onClick={() => {
                  if (
                    !locked &&
                    window.confirm(
                      "将所选对白音频改为 BGM 并移除剧本绑定？素材、裁剪和旧保存版本保留，此修改可撤销。",
                    )
                  )
                    onEdit(bindAssemblyDialogue(content, segment.segment_id, null));
                }}
              >
                改为 BGM 并移除对白绑定
              </Button>
            )}
          </>
        )}
        <p>
          仅绑定已导入录音，未生成声音。绑定不证明录音说出了该对白或已完成口型同步。说话者和画内／画外呈现取自该剧本版本；剪切与分割保留绑定，改绑需保存新的本集剪辑版本。
        </p>
      </div>
    </details>
  );
}
