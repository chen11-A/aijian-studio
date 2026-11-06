import { useEffect, useMemo, useState } from "react";
import type {
  BundledAudioAsset,
  AddBundledFilmAudioInput,
} from "@aijian/contracts/film-audio-library";
import "./BundledAudioDialog.css";
type Placement = AddBundledFilmAudioInput["placement"];
export type BundledAudioChoice = {
  assetId: string;
  lane: AddBundledFilmAudioInput["lane"];
  placement: Placement;
};
function sourceLink(source: string) {
  try {
    const url = new URL(source);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function BundledAudioDialog({
  assets,
  loading,
  target,
  targetBusy,
  busy,
  locked,
  message,
  versionLabel,
  onRefreshTarget,
  onRetryCatalog,
  onAdd,
  onClose,
  onRecover,
  recovering = false,
}: {
  assets: readonly BundledAudioAsset[] | null;
  loading: boolean;
  target: { key: string; durationSeconds: number } | null;
  targetBusy: boolean;
  busy: boolean;
  locked: boolean;
  message: string;
  versionLabel: string;
  onRefreshTarget: () => void;
  onRetryCatalog: () => void;
  onAdd: (choice: BundledAudioChoice) => void;
  onClose: () => void;
  onRecover?: () => void;
  recovering?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const asset = assets?.find((item) => item.id === selected);
  const [lane, setLane] = useState<AddBundledFilmAudioInput["lane"]>("sfx");
  const [start, setStart] = useState("0"),
    [offset, setOffset] = useState("0"),
    [duration, setDuration] = useState("");
  const [gain, setGain] = useState("0"),
    [loop, setLoop] = useState(false);
  const seconds =
    target && Number.isFinite(target.durationSeconds) && target.durationSeconds > 0
      ? target.durationSeconds
      : null;
  useEffect(() => {
    setStart("0");
    setOffset("0");
    setGain("0");
    setLoop(false);
    setDuration(asset && seconds !== null ? String(Math.min(asset.durationSeconds, seconds)) : "");
  }, [selected, target?.key, seconds, asset?.durationSeconds]);
  const shown = useMemo(
    () =>
      (assets ?? []).filter((item) =>
        `${item.name} ${item.category} ${item.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      ),
    [assets, query],
  );
  const placement = {
    startSeconds: Number(start),
    offsetSeconds: Number(offset),
    durationSeconds: Number(duration),
    gainDb: Number(gain),
    loop,
  };
  const valid = !!(
    asset &&
    seconds !== null &&
    ![start, offset, duration, gain].some((s) => s.trim() === "") &&
    Object.values(placement)
      .filter((n) => typeof n === "number")
      .every(Number.isFinite) &&
    placement.startSeconds >= 0 &&
    placement.offsetSeconds >= 0 &&
    placement.durationSeconds > 0 &&
    placement.gainDb >= -24 &&
    placement.gainDb <= 12 &&
    placement.startSeconds + placement.durationSeconds <= seconds + 0.000001 &&
    placement.offsetSeconds < asset.durationSeconds &&
    (!loop || asset.loopable) &&
    (loop ||
      placement.durationSeconds <= asset.durationSeconds - placement.offsetSeconds + 0.000001)
  );
  const disabled = busy || locked;
  const url = asset ? sourceLink(asset.source) : null;
  return (
    <div className="dialog-back">
      <section
        className="dialog bundled-audio-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="选用本地音效或配乐"
        aria-busy={busy || loading || targetBusy}
      >
        <h2>选用本地音效或配乐</h2>
        <p>
          一次加入一份素材，绑定当前镜头的{versionLabel}
          。这里没有试听；加入后可用剪辑页的四轨试听核对。
        </p>
        <div className="bundled-audio-body">
          <div className="bundled-audio-catalog">
            <label>
              查找名称或类别
              <input
                className="input"
                type="search"
                value={query}
                disabled={disabled}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <p role="status">
              {loading
                ? "正在读取本地素材目录…"
                : assets
                  ? `${assets.length} 份本地素材，当前显示 ${shown.length} 份。`
                  : "本地素材目录没有读到。"}
            </p>
            {!loading && !assets ? (
              <button className="btn" disabled={disabled} onClick={onRetryCatalog}>
                重读素材目录
              </button>
            ) : null}
            <div className="bundled-audio-list" role="radiogroup" aria-label="本地素材">
              {shown.map((item) => (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={selected === item.id}
                  className="bundled-audio-item"
                  disabled={disabled}
                  onClick={() => {
                    setSelected(item.id);
                    setLane(item.type === "music" ? "score" : "sfx");
                  }}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.category} · {item.durationSeconds.toFixed(2)} 秒
                    {item.loopable ? " · 可循环" : " · 不循环"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="bundled-audio-details">
            {asset ? (
              <>
                <h3>{asset.name}</h3>
                <dl>
                  <dt>类别</dt>
                  <dd>{asset.category}</dd>
                  <dt>作者</dt>
                  <dd>{asset.author || "未提供"}</dd>
                  <dt>许可</dt>
                  <dd>{asset.license || "未提供"}</dd>
                  <dt>来源</dt>
                  <dd>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        {asset.source}
                      </a>
                    ) : asset.source &&
                      !/^[a-z][a-z\d+.-]*:/i.test(asset.source) &&
                      !asset.source.startsWith("/") &&
                      !asset.source.startsWith("\\") ? (
                      asset.source
                    ) : (
                      "未提供可安全打开的来源链接"
                    )}
                  </dd>
                  <dt>素材时长</dt>
                  <dd>
                    {asset.durationSeconds.toFixed(2)} 秒 ·{" "}
                    {asset.loopable ? "允许循环" : "不允许循环"}
                  </dd>
                </dl>
              </>
            ) : (
              <p>先选择一份素材，再核对来源和使用位置。</p>
            )}
            <p role="status">
              {targetBusy
                ? "正在核对当前版本的实际时长…"
                : seconds !== null
                  ? `当前版本已核对：${seconds.toFixed(2)} 秒。`
                  : "当前版本的实际时长尚未核对，暂不能加入。"}
            </p>
            <button className="btn" disabled={disabled || targetBusy} onClick={onRefreshTarget}>
              核对当前版本时长
            </button>
            <fieldset disabled={disabled || targetBusy || seconds === null || !asset}>
              <legend>加入位置</legend>
              <label>
                加入轨道
                <select
                  className="input"
                  value={lane}
                  onChange={(e) => setLane(e.target.value as BundledAudioChoice["lane"])}
                >
                  <option value="ambience">环境音</option>
                  <option value="sfx">音效</option>
                  <option value="score">配乐</option>
                </select>
              </label>
              <label>
                开始时间（镜头内，秒）
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                素材起点（秒）
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                />
              </label>
              <label>
                使用时长（秒）
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
              <label>
                片段音量（dB）
                <input
                  className="input"
                  type="number"
                  min="-24"
                  max="12"
                  step="0.1"
                  value={gain}
                  onChange={(e) => setGain(e.target.value)}
                />
              </label>
              <label className="bundled-audio-loop">
                <input
                  type="checkbox"
                  checked={loop}
                  disabled={!asset?.loopable}
                  onChange={(e) => setLoop(e.target.checked)}
                />
                循环到所选时长
              </label>
              <p>保留素材已经处理好的响度，不会再把处理增益加一次。循环不代表无缝连接。</p>
            </fieldset>
            {asset && seconds !== null && !valid ? (
              <p role="alert">
                请核对位置和时长：不能超出当前版本；不循环时也不能超出素材剩余时长。
              </p>
            ) : null}
          </div>
        </div>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {onRecover ? (
          <button className="btn" disabled={busy} onClick={onRecover}>
            {recovering ? "正在核对保存状态…" : "核对保存状态"}
          </button>
        ) : null}
        <div className="acts">
          <button className="btn" disabled={busy} onClick={onClose}>
            关闭
          </button>
          <button
            className="btn primary"
            disabled={disabled || targetBusy || !valid}
            onClick={() => {
              if (valid && asset) onAdd({ assetId: asset.id, lane, placement });
            }}
          >
            {busy ? (recovering ? "正在核对…" : "正在加入…") : "加入当前版本"}
          </button>
        </div>
      </section>
    </div>
  );
}
