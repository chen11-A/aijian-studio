import type { FilmProject } from "../../film/project";
import type { AgentReply } from "../workflow";

export type PortraitIdentityHost = {
  current: () => FilmProject | null;
  valid: () => boolean;
  request: (agent: "writer", context: string, instruction: string) => Promise<AgentReply>;
  apply: (film: FilmProject) => void;
  confirm: (characterId: string) => Promise<void>;
  notice: (text: string) => void;
  failed: () => void;
};

/** Prepare the identity before delegating media ownership, persistence and generation to
 * the existing portrait workflow. The workspace supplies its project/request guard. */
export async function preparePortraitIdentity(
  base: FilmProject,
  characterId: string,
  host: PortraitIdentityHost,
): Promise<void> {
  const character = base.characters.find((item) => item.id === characterId);
  if (!character) return;
  try {
    if (!character.identity.trim()) {
      host.notice("正在从剧本里看这个人的外貌。");
      const story =
        base.scenes
          .map((item) => item.text)
          .filter(Boolean)
          .join("\n") || base.title;
      const reply = await host.request(
        "writer",
        story,
        `只写「${character.name}」的一句外貌，必须写明性别和大致年龄。看不出来就只写：性别未写明。`,
      );
      if (!host.valid()) return;
      const line = (reply.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!line || line.includes("性别未写明")) {
        host.notice("先写下外貌，再出定妆照。");
        return;
      }
      const latest = host.current();
      if (!latest || latest.id !== base.id) return;
      const liveCharacter = latest.characters.find((item) => item.id === character.id);
      if (!liveCharacter || liveCharacter.identity !== character.identity) return;
      host.apply({
        ...latest,
        characters: latest.characters.map((item) =>
          item.id === character.id ? { ...item, identity: line } : item,
        ),
      });
    }
    if (host.valid()) await host.confirm(character.id);
  } catch {
    if (host.valid()) host.failed();
  }
}
