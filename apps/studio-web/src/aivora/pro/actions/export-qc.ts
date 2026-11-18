import { audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import type {
  FilmExportIncomplete,
  FilmExportQcInput,
  FilmExportQcSettings,
  FilmExportQcFailure,
} from "@aijian/contracts/film-export-qc";
import type { FilmProject } from "../../film/project";
import { exportAspectPlan, type ExportAspectChoice } from "./export-selection";
const chosenTake = (shot: FilmProject["shots"][number]) =>
  shot.takes.find(
    (take) =>
      (!shot.selectedTakeId || take.id === shot.selectedTakeId) &&
      take.status === "done" &&
      take.videoPath,
  );
export function filmQcInput(
  film: FilmProject,
  choice: ExportAspectChoice,
  settings: Omit<FilmExportQcSettings, "aspects">,
  requestedFileName?: string,
): FilmExportQcInput {
  return {
    projectId: film.id,
    expectedSelection: film.shots.map((shot) => ({
      shotId: shot.id,
      takeId: chosenTake(shot)?.id ?? "",
    })),
    settings: {
      aspects: exportAspectPlan(film, choice),
      autoAdjustVolume: audioMixSettings(film.audioMix).autoAdjustVolume,
      ...settings,
    },
    ...(requestedFileName !== undefined ? { requestedFileName } : {}),
  };
}
export function filmQcKey(film: FilmProject | null, input: FilmExportQcInput | null) {
  if (!film || !input) return "";
  const content = Object.fromEntries(
    Object.entries(film).filter(([key]) => !["savedAt", "directory"].includes(key)),
  );
  return JSON.stringify({ content, input });
}
export const qcFailureText: Record<FilmExportQcFailure["code"], string> = {
  AUDIO_MIX_LIMIT: "本次音轨数量或路径长度超出本机混音范围，请缩短工程路径或分段处理后重新检查。",
  INVALID_INPUT: "检查请求不完整，请重新选择工程和导出设置。",
  PROJECT_CHANGED: "工程或选定版本已经变化，请重新检查。",
  MISSING_MEDIA: "还有镜头未生成，或本地素材不可读取，请先检查镜头。",
  SOURCE_UNVERIFIED: "这份素材的归属暂无法核验，请保留原素材并核对来源。",
  CLEAN_COPY_REQUIRED: "这份素材的字幕已在画面里，请先补做不带字幕的副本。",
  TOOLS_UNAVAILABLE: "固定的视频检查工具没有通过校验，请检查本机工具配置。",
  CHECK_FAILED: "本次技术检查没有完成，尚不能发布。",
  RECEIPT_STALE: "这份检查结果已经失效，请重新检查。",
  QC_BLOCKED: "成片仍有要先处理的问题，请查看检查清单。",
  PUBLISH_FAILED: "发布没有完成，请检查输出文件夹后重新检查。",
  OPERATION_STOPPED: "处理已停止，未发布的文件没有保存。",
  BUSY: "同一工程已有检查或发布正在进行，请等待。",
  MATERIALS_STALE: "有旧版本或已失效的配声/整场配声，请在剪辑里停用或重新选用后再导出。",
  AUDIO_DECISION_INVALID: "作品里的声音决定已损坏，请重新选择本片静音或有声导出。",
  UNSUPPORTED_AUDIO_CHANNELS:
    "有声导出只接受单声道或立体声源。超过两声道时请改建立体声，或选择本片静音。",
  EXPORT_NAME_INVALID: "导出文件名是空的，或只含不能写入文件名的字符。请改一个名字。",
  EXPORT_NAME_TAKEN: "已有同名文件，请换个名字或换文件夹。",
  EXPORT_NAME_EXHAUSTED: "默认导出名的序号已经用完，请换个名字或换文件夹。",
};
const incompleteReason: Record<FilmExportIncomplete["code"], string> = {
  DISK_FULL: "磁盘空间不足",
  PUBLISH_FAILED: "写入失败",
};
/** Shared wording for a kept aspect after the other aspect failed to write. */
export function partialAspectNotice(incomplete: FilmExportIncomplete): string {
  const failed = incomplete.aspectRatio === "9:16" ? "竖屏" : "横屏";
  const kept = incomplete.aspectRatio === "9:16" ? "横屏" : "竖屏";
  return `${failed}没有写完：${incompleteReason[incomplete.code]}；${kept}已保存`;
}
