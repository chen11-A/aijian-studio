import type { SceneAudioPlan } from "./actions/scene-audio-suggestions";
import type { ShotAudioPlan } from "./actions/shot-audio-suggestions";
import "./ShotAudioSuggestionDialog.css";
const lanes = [
  ["ambience", "环境音"],
  ["sfx", "音效"],
  ["score", "配乐"],
] as const;
function number(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4, useGrouping: false }).format(
    Object.is(value, -0) ? 0 : value,
  );
}
function sourceLink(source: string) {
  try {
    const url = new URL(source);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function empty(plan: ShotAudioPlan | SceneAudioPlan, lane: string) {
  const codes = new Set([...plan.warnings, ...plan.limitations].map((n) => n.code));
  if (lane === "score") {
    if (codes.has("MUSIC_DISABLED") || codes.has("MUSIC_QUIET"))
      return plan.kind === "SCENE_SUGGESTED" ? "本场配乐留白。" : "本镜配乐留白。";
    if (codes.has("MUSIC_MOOD_UNDECIDED")) return "配乐情绪待决定，暂未安排素材。";
    if (codes.has("MUSIC_MATCH_MISSING")) return "本地目录没有匹配的配乐。";
  }
  return "本次没有安排片段；请结合下方提醒核对，不能据此认定这里不需要声音。";
}
export function ShotAudioSuggestionDialog({
  plan,
  busy,
  message,
  onRefresh,
  onClose,
  canApply = false,
  applying = false,
  selectedLanes = [],
  existingClips = 0,
  onLanes,
  onApply,
  sceneMode = false,
}: {
  plan: ShotAudioPlan | SceneAudioPlan | null;
  busy: boolean;
  message: string;
  onRefresh: () => void;
  onClose: () => void;
  canApply?: boolean;
  applying?: boolean;
  selectedLanes?: readonly ("ambience" | "sfx" | "score")[];
  existingClips?: number;
  onLanes?: (lanes: ("ambience" | "sfx" | "score")[]) => void;
  onApply?: () => void;
  sceneMode?: boolean;
}) {
  const scenePlan = plan?.kind === "SCENE_SUGGESTED" ? plan : null;
  return (
    <div className="dialog-back">
      <section
        role="dialog"
        aria-modal="true"
        aria-busy={busy || applying}
        aria-labelledby="shot-audio-suggestions-title"
        className="dialog shot-audio-suggestions"
      >
        <h2 id="shot-audio-suggestions-title">{sceneMode ? "本场声音建议" : "本镜声音建议"}</h2>
        <p>
          {sceneMode
            ? "这是根据当前场次文字、全片实际选版时钟和本地素材给出的整场安排。"
            : "这是根据当前镜头文字和本地素材给出的安排。"}
          查看不会添加声音，也没有试听；明确选用后才加入。片段位置是计划值，不代表已观看或听过成片。
        </p>
        <p role="status" aria-live="polite">
          {applying
            ? "正在加入并核对本次声音，请等待保存结果…"
            : busy
              ? "正在核对当前镜头并读取建议…"
              : message}
        </p>
        {plan && (
          <>
            <p>
              {scenePlan ? (
                <>
                  本场从全片第 {number(scenePlan.sceneStartSeconds)} 秒开始，实际跨度{" "}
                  {number(scenePlan.sceneDurationSeconds)} 秒；全片{" "}
                  {number(scenePlan.clock.durationSeconds)} 秒。
                </>
              ) : (
                <>
                  当前视频时长 {number(plan.kind === "SUGGESTED" ? plan.durationSeconds : 0)} 秒。
                </>
              )}{" "}
              共 {plan.clips.length} 段。建议只对应本次核对的版本；修改内容或素材后需刷新。
            </p>
            {lanes.map(([lane, label]) => {
              const clips = plan.clips.filter((c) => c.lane === lane);
              return (
                <section className="shot-audio-lane" aria-label={`${label}建议`} key={lane}>
                  <h3>
                    {label} · {clips.length} 段
                  </h3>
                  {!clips.length && <p>{empty(plan, lane)}</p>}
                  {clips.map((clip, index) => {
                    const p = clip.placement,
                      a = clip.asset,
                      link = sourceLink(a.source),
                      clockRow =
                        scenePlan && "shotId" in clip && "takeId" in clip
                          ? scenePlan.clock.shots.find(
                              (row) => row.shotId === clip.shotId && row.takeId === clip.takeId,
                            )
                          : null;
                    return (
                      <article key={clip.key} aria-label={`${label}第${index + 1}段`}>
                        <h4>
                          {index + 1}. {a.name}
                        </h4>
                        <p>建议 · 未生成</p>
                        {scenePlan && "shotId" in clip && "takeId" in clip && (
                          <p>
                            全片第{" "}
                            {scenePlan.clock.shots.findIndex(
                              (row) => row.shotId === clip.shotId && row.takeId === clip.takeId,
                            ) + 1}{" "}
                            镜；以下起止时间均在该镜头内。
                          </p>
                        )}
                        {clockRow && (
                          <p>
                            该镜实际从全片 {number(clockRow.startSeconds)} 秒开始，长{" "}
                            {number(clockRow.durationSeconds)} 秒；本段计划在全片{" "}
                            {number(clockRow.startSeconds + p.startSeconds)} →{" "}
                            {number(clockRow.startSeconds + p.startSeconds + p.durationSeconds)}{" "}
                            秒。
                          </p>
                        )}
                        <p>{clip.reason}</p>
                        <dl>
                          <dt>类别 / 使用场景</dt>
                          <dd>
                            {a.category || "未标注"} / {a.scene || "未标注"}
                          </dd>
                          <dt>作者 / 许可 / 来源</dt>
                          <dd>
                            {a.author || "未标注"} / {a.license || "未标注"} /{" "}
                            {link ? (
                              <a href={link} target="_blank" rel="noreferrer">
                                查看素材来源
                              </a>
                            ) : (
                              "未提供可打开的来源链接"
                            )}
                          </dd>
                          <dt>素材时长 / 可循环</dt>
                          <dd>
                            {number(a.durationSeconds)} 秒 / {a.loopable ? "可循环" : "不可循环"}
                          </dd>
                          <dt>镜头内计划起止</dt>
                          <dd>
                            {number(p.startSeconds)} → {number(p.startSeconds + p.durationSeconds)}{" "}
                            秒（{number(p.durationSeconds)} 秒）
                          </dd>
                          <dt>源素材起点 / 片段音量 / 重复</dt>
                          <dd>
                            {number(p.offsetSeconds)} 秒 / {number(p.gainDb)} dB /{" "}
                            {p.loop ? "按计划循环" : "不重复"}
                          </dd>
                        </dl>
                        {clip.envelope ? (
                          <div className="shot-audio-envelope">
                            <p>
                              以下时间以本片段开头为零；负值表示变化已在片段前开始。音量参考值{" "}
                              {number(clip.envelope.baseGainDb)} dB 用来计算变化，不会再次叠加。
                            </p>
                            <h5>淡入淡出 · {clip.envelope.fades?.length ?? 0} 项</h5>
                            {clip.envelope.fades?.length ? (
                              <ul>
                                {clip.envelope.fades.map((f, i) => (
                                  <li key={i}>
                                    {f.direction === "in" ? "淡入" : "淡出"}：起点{" "}
                                    {number(f.startSeconds)} 秒，持续 {number(f.durationSeconds)} 秒
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>未安排淡入淡出。</p>
                            )}
                            <h5>音量变化 · {clip.envelope.gainAutomation?.length ?? 0} 项</h5>
                            {clip.envelope.gainAutomation?.length ? (
                              <ul>
                                {clip.envelope.gainAutomation.map((g, i) => (
                                  <li key={i}>
                                    {number(g.startSeconds)} → {number(g.endSeconds)} 秒：
                                    {number(g.gainDb)} dB
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>未安排额外音量变化。</p>
                            )}
                          </div>
                        ) : (
                          <p>未安排淡入淡出或额外音量变化。</p>
                        )}
                      </article>
                    );
                  })}
                </section>
              );
            })}
            <section aria-label="声音建议提醒">
              <h3>提醒 · {plan.warnings.length} 项</h3>
              {plan.warnings.length ? (
                <ul>
                  {plan.warnings.map((note, i) => (
                    <li key={i}>
                      {note.message}
                      {scenePlan &&
                        note.shotIndex !== undefined &&
                        `（全片第 ${note.shotIndex + 1} 镜）`}
                      {note.index !== undefined && `（第 ${note.index} 项）`}
                      {note.seconds !== undefined && ` · ${number(note.seconds)} 秒`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>本次没有额外提醒。</p>
              )}
            </section>
            <section aria-label="声音建议限制">
              <h3>尚未核实与限制 · {plan.limitations.length} 项</h3>
              {plan.limitations.length ? (
                <ul>
                  {plan.limitations.map((note, i) => (
                    <li key={i}>
                      {note.message}
                      {scenePlan &&
                        note.shotIndex !== undefined &&
                        `（全片第 ${note.shotIndex + 1} 镜）`}
                      {note.index !== undefined && `（第 ${note.index} 项）`}
                      {note.seconds !== undefined && ` · ${number(note.seconds)} 秒`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>本次没有额外限制说明；仍需人工试听与核对。</p>
              )}
            </section>
          </>
        )}
        {plan && canApply && (
          <fieldset disabled={busy || applying}>
            <legend>明确选择本次要加入的轨道</legend>
            <p>
              每条轨道会加入完整建议片段，不替换作品已有的 {existingClips}{" "}
              段声音。默认不选用；先核对以上全部安排与限制。
            </p>
            {lanes.map(([lane, label]) => {
              const count = plan.clips.filter((c) => c.lane === lane).length;
              return (
                <label className="shot-audio-choice" key={lane}>
                  <input
                    type="checkbox"
                    checked={selectedLanes.includes(lane)}
                    disabled={count === 0}
                    onChange={(event) =>
                      onLanes?.(
                        event.target.checked
                          ? [...selectedLanes, lane]
                          : selectedLanes.filter((v) => v !== lane),
                      )
                    }
                  />
                  {label} · 完整 {count} 段
                </label>
              );
            })}
            <p>
              本次将追加 {plan.clips.filter((c) => selectedLanes.includes(c.lane)).length}{" "}
              段。若要撤销这次添加，请移除对应的声音组；素材文件仍保留。
            </p>
            <button
              className="btn primary"
              disabled={busy || applying || selectedLanes.length === 0}
              onClick={onApply}
            >
              选用所选轨道的完整建议
            </button>
          </fieldset>
        )}
        <div className="acts">
          <button className="btn" disabled={busy || applying} onClick={onRefresh}>
            刷新建议
          </button>
          <button className="btn" disabled={applying} onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
