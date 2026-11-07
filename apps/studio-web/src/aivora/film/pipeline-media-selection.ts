import type { FilmShot } from "./project";

/** Original pipeline path/selection rules; actual consumers independently verify bytes. */
export function pipelineMediaPath(path: string, kind: "image" | "video"): boolean {
  let value = path.trim();
  if (kind === "image" && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value))
    return true;
  try {
    const url = new URL(value);
    if (
      kind === "image" &&
      url.protocol === "https:" &&
      url.hostname &&
      !url.username &&
      !url.password
    )
      return true;
    if (url.protocol === "aivora-media:" && url.hostname === "local")
      value = url.searchParams.get("path") ?? "";
  } catch {
    /* A desktop filesystem path is also valid. */
  }
  return (
    (/^\//.test(value) || /^[a-z]:[\\/]/i.test(value)) &&
    !value.includes("\0") &&
    (kind === "video" ? /\.(mp4|webm|mov)$/i : /\.(png|jpe?g|webp)$/i).test(value)
  );
}
export function pipelineSelectedVideo(shot: FilmShot): string {
  const done = shot.takes.filter(
    (take) => take.status === "done" && pipelineMediaPath(take.videoPath, "video"),
  );
  const selected = shot.selectedTakeId
    ? done.find((take) => take.id === shot.selectedTakeId)
    : done.length === 1
      ? done[0]
      : undefined;
  return selected?.videoPath ?? "";
}
