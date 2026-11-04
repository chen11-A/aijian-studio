import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { createProductionActions } from "./production-actions";

it("keeps explicitly cleared traits empty and preserves a manually chosen voice", async () => {
  let film = sampleFilm();
  const id = film.characters[0]!.id;
  const actions = createProductionActions({
    current: () => film,
    apply: (next) => {
      film = next;
    },
    requestDirector: vi.fn(),
    notify: vi.fn(),
  });
  await actions.updateCharacterTraits(id, { gender: "", ageBand: "" });
  expect(film.characters[0]).toMatchObject({
    gender: "",
    ageBand: "",
    voiceId: "",
    voiceCode: "VOICE_TRAITS_REQUIRED",
  });
  film.characters[0] = {
    ...film.characters[0]!,
    voiceId: "custom-user-voice",
    userFields: ["voiceId"],
  };
  await actions.updateCharacterTraits(id, { gender: "男", ageBand: "老年" });
  expect(JSON.parse(JSON.stringify(film)).characters[0]).toMatchObject({
    gender: "男",
    ageBand: "老年",
    voiceId: "custom-user-voice",
  });
});
