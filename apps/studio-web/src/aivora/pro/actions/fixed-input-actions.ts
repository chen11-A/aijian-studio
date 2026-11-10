import type { FilmProject, FilmShot } from "../../film/project";
import { updateShot } from "../../film/operations";
import { fileMediaUrl } from "../workflow";

/** Renderer asks main to open its own dialog. Path, origin, metadata and cacheHit stay here. */
export async function importShotFixedInput(
  film: FilmProject,
  shot: FilmShot,
  onFilm: (film: FilmProject) => void,
  onNotice: (text: string) => void,
): Promise<void> {
  const bridge = window.aijian?.importFixedInput;
  if (!bridge) {
    onNotice("请打开安装好的 AIVORA 再导入固定输入。");
    return;
  }
  const result = await bridge(film.id);
  if (!result.ok) {
    onNotice(
      result.code === "CANCELLED"
        ? "已取消导入固定输入。"
        : result.code === "LEDGER_FULL"
          ? "这一轮可确认的手工画面已满。没有把它当作固定输入。可以重新选择；重启后需要再次明确确认，旧确认不会保留。"
          : "这张图不能当作固定输入。",
    );
    return;
  }
  const poster = fileMediaUrl(result.path) || result.path;
  onFilm(updateShot(film, shot.id, { poster }));
  onNotice("已导入这张画面为固定输入。随后的视频准备仍会核对当前文件。");
}

/** Confirms a main-issued offer. The offer id is not an authorization fact by itself. */
export async function confirmShotFixedInput(
  projectId: string,
  offerId: string,
  onNotice: (text: string) => void,
): Promise<void> {
  const bridge = window.aijian?.confirmFixedInput;
  if (!bridge) {
    onNotice("请打开安装好的 AIVORA 再确认固定输入。");
    return;
  }
  const result = await bridge(projectId, offerId);
  onNotice(
    result.ok
      ? "已确认这张手工画面为固定输入。"
      : result.code === "LEDGER_FULL"
        ? "这一轮可确认的手工画面已满。没有把它当作固定输入。可以重新选择；重启后需要再次明确确认，旧确认不会保留。"
        : "这张手工画面还不能当作固定输入。",
  );
}
