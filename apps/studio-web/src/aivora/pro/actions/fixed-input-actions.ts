import type { FilmProject, FilmShot } from "../../film/project";
import { updateShot } from "../../film/operations";
import { fileMediaUrl } from "../workflow";

const receiptFullNotice =
  "这一轮固定输入确认已满，重新选择也不能再增加。重启后这些确认不会保留，需要再次明确确认。";

/** Renderer asks main to open its own dialog. Path, origin, metadata and cacheHit stay here. */
export async function importShotFixedInput(
  film: FilmProject,
  shot: FilmShot,
  host: {
    current: () => FilmProject | null;
    apply: (film: FilmProject) => void;
    onNotice: (text: string) => void;
  },
): Promise<void> {
  const bridge = window.aijian?.importFixedInput;
  if (!bridge) {
    host.onNotice("请打开安装好的 AIVORA 再导入固定输入。");
    return;
  }
  const result = await bridge(film.id);
  if (!result.ok) {
    host.onNotice(
      result.code === "CANCELLED"
        ? "已取消导入固定输入。"
        : result.code === "LEDGER_FULL"
          ? receiptFullNotice
          : "这张图不能当作固定输入。",
    );
    return;
  }
  const live = host.current();
  if (!live || live.id !== film.id || !live.shots.some((item) => item.id === shot.id)) {
    host.onNotice("当前作品或镜头已经变化，没有把这张图写进旧稿。");
    return;
  }
  const poster = fileMediaUrl(result.path) || result.path;
  host.apply(updateShot(live, shot.id, { poster }));
  host.onNotice("已导入这张画面为固定输入。随后的视频准备仍会核对当前文件。");
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
        ? receiptFullNotice
        : "这张手工画面还不能当作固定输入。",
  );
}
