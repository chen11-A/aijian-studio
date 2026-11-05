import type { FilmProject } from "../../film/project";

/**
 * Plain names for the targets of 一键成片 (GPT film-pipeline-controller filmPipelineTargets):
 * 「script」「cast」「art」, 「<character id>@<view>」, 「location:<id>」, a scene id, a shot id,
 * and 「all」. Anything else is left unnamed, so an internal id never reaches the screen.
 */
export function pipelineTargetName(film: FilmProject, targetId: string): string {
  if (targetId === "all") return "整部作品";
  if (targetId === "script") return "剧本";
  if (targetId === "cast") return "人物";
  if (targetId === "art") return "画风和外貌";
  if (targetId.startsWith("location:")) {
    const place = film.locations.find((item) => item.id === targetId.slice(9));
    return place?.name ? `场景「${place.name}」` : "";
  }
  const at = targetId.lastIndexOf("@");
  if (at > 0) {
    const person = film.characters.find((item) => item.id === targetId.slice(0, at));
    return person ? `${person.name} · ${targetId.slice(at + 1)}` : "";
  }
  const shot = film.shots.find((item) => item.id === targetId);
  if (shot) {
    const scene = film.scenes.find((item) => item.id === shot.sceneId);
    return scene ? `第 ${scene.no} 场第 ${shot.no} 个镜头` : `第 ${shot.no} 个镜头`;
  }
  return pipelineSceneName(film, targetId);
}

/** 「第 2 场「码头仓库」」, or empty for a scene the work no longer has. */
export function pipelineSceneName(film: FilmProject, sceneId: string): string {
  const scene = film.scenes.find((item) => item.id === sceneId);
  if (!scene) return "";
  return scene.title.trim() ? `第 ${scene.no} 场「${scene.title.trim()}」` : `第 ${scene.no} 场`;
}
