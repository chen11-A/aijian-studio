import { pages } from "./data";
import { shotAtTime, useDemo } from "./model";

export function useCurrentObject() {
  const d = useDemo();
  const shot = (d.page === "storyboard"
    ? shotAtTime(d.shots, d.time)
    : d.shots.find((item) => item.id === d.selectedShot)) ??
    d.shots[0] ?? { id: 0, name: "尚未读取镜头", image: "", duration: 0, note: "" };
  const person = d.characters.find((item) => item.id === d.selectedCharacter) ??
    d.characters[0] ?? { id: 0, name: "尚未读取角色", role: "尚未接入", image: "", note: "" };
  const isShot = ["storyboard", "generation", "assembly", "review", "export"].includes(d.page);
  const isCharacter = ["character", "characters", "voice"].includes(d.page);
  const family = isShot
    ? d.page === "storyboard"
      ? "shot"
      : d.page
    : isCharacter
      ? "character"
      : ["source", "story", "script"].includes(d.page)
        ? "story"
        : d.page;
  const scope = isShot
    ? `${family}-${shot.id}`
    : isCharacter
      ? `character-${person.id}`
      : family === "scenes"
        ? `scene-${d.selectedLocation}`
        : `${family}-${d.value("projectId", "1")}-${d.value("episode")}`;
  const label = isShot
    ? `Shot ${String(shot.id).padStart(3, "0")} · ${shot.name}`
    : isCharacter
      ? person.name
      : d.page === "scenes"
        ? (d.locations.find((item) => item.id === d.selectedLocation)?.name ?? "场景")
        : family === "story"
          ? d.value("episode")
          : pages[d.page][0];
  const aliases: Record<string, string> =
    family === "world"
      ? { description: "worldNote", style: "worldStyle" }
      : family === "story"
        ? { source: "source", summary: "summary" }
        : {};
  const currentOutfits = d.outfits.filter(
    (item) => item.characterId === person.id && item.episode === d.value("episode"),
  );
  const currentOutfit =
    currentOutfits.find((item) => String(item.id) === d.value(`${scope}-outfitId`)) ??
    currentOutfits[0];
  const field = (key: string, fallback = "") =>
    family === "character" && key === "outfit"
      ? (currentOutfit?.name ?? fallback)
      : d.value(aliases[key] ?? `${scope}-${key}`, fallback);
  const putField = (key: string, value: string) => {
    d.put(aliases[key] ?? `${scope}-${key}`, value);
    if (family === "character" && !["mainTab", "view", "outfitId"].includes(key)) {
      d.put(`locked-${person.id}`, "false");
      d.put("assetsConfirmed", "false");
      if (key === "outfit" && currentOutfit && currentOutfit.name !== value)
        d.setOutfits((old) =>
          old.map((item) =>
            item.id === currentOutfit.id
              ? { ...item, name: value, version: item.version + 1, confirmed: false }
              : item,
          ),
        );
    }
    if (family === "world") {
      d.put("worldConfirmed", "false");
      d.put("assetsConfirmed", "false");
    }
    if (family === "scenes" && !["view", "confirmed"].includes(key)) {
      d.put(`${scope}-confirmed`, "false");
      d.put("assetsConfirmed", "false");
    }
    if (family === "story" && key === "source") {
      d.put("sourceVersion", String(Number(d.value("sourceVersion", "1")) + 1));
      ["sourceApproved", "storyConfirmed", "ambiguity1", "ambiguity2"].forEach((flag) =>
        d.put(flag, "false"),
      );
    }
  };
  const shotField = (key: string, fallback = "") => d.value(`shot-${shot.id}-${key}`, fallback);
  const characterId = Number(shotField("characterId", "0"));
  const character = d.characters.find((item) => item.id === characterId) ?? person;
  const scene = shotField("scene", "尚未读取场景");
  const detail = isShot
    ? `${scene} · ${shot.duration.toFixed(1)}s · ${character.name}`
    : isCharacter
      ? `${person.role} · ${field("version", "v4")}`
      : d.value("episode");
  return {
    d,
    shot,
    person,
    isShot,
    isCharacter,
    family,
    scope,
    label,
    field,
    putField,
    shotField,
    scene,
    character,
    detail,
  };
}
