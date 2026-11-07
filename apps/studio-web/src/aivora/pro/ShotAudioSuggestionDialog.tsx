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
function empty(plan: ShotAudioPlan, lane: string) {
  const codes = new Set([...plan.warnings, ...plan.limitations].map((n) => n.code));
  if (lane === "score") {
    if (codes.has("MUSIC_DISABLED") || codes.has("MUSIC_QUIET")) return "本镜配乐留白。";
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
}: {
  plan: ShotAudioPlan | null;
  busy: boolean;
  message: string;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-back">
      <section
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="shot-audio-suggestions-title"
        className="dialog shot-audio-suggestions"
      >
        <h2 id="shot-audio-suggestions-title">本镜声音建议</h2>
        <p>
          这是根据当前镜头文字和本地素材给出的安排，尚未添加声音，也没有试听。时间是计划值，不代表已观看或听过成片。
        </p>
        <p role="status" aria-live="polite">
          {busy ? "正在核对当前镜头并读取建议…" : message}
        </p>
        {plan && (
          <>
            <p>
              当前视频时长 {number(plan.durationSeconds)} 秒，共 {plan.clips.length}{" "}
              段。建议只对应本次核对的版本；修改内容或素材后需刷新。
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
                      link = sourceLink(a.source);
                    return (
                      <article key={clip.key} aria-label={`${label}第${index + 1}段`}>
                        <h4>
                          {index + 1}. {a.name}
                        </h4>
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
        <div className="acts">
          <button className="btn" disabled={busy} onClick={onRefresh}>
            刷新建议
          </button>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
