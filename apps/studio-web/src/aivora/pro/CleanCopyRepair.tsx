/** A repair reuses an existing assembly; the host owns dispatch, persistence and notices. */
export function CleanCopyRepair({
  mode,
  count,
  busy,
  onRepair,
}: {
  mode: "shot" | "export";
  count: number;
  busy: boolean;
  onRepair: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="clean-copy-repair">
      <p className="role-desc">
        {mode === "shot"
          ? "当前选中版本还没有不带字幕的那份。"
          : `有 ${count} 个镜头还没有不带字幕的版本。补好后，请再点导出。`}
      </p>
      <button className="btn sm" type="button" disabled={busy} onClick={onRepair}>
        {busy
          ? "正在补做无字幕版本…"
          : mode === "shot"
            ? "补做不带字幕的版本"
            : `一键补做这 ${count} 镜`}
      </button>
      <p className="role-desc">使用原来的合成记录，不重新生成视频。</p>
    </div>
  );
}
