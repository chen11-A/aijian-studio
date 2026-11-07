import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import {
  assistantReferencesCurrent,
  captureAssistantReferences,
  referenceCandidates,
} from "./assistant-references";
function setup() {
  const film = sampleFilm();
  film.characters = [
    {
      ...film.characters[0]!,
      id: "person-one",
      name: "林夏",
      identity: "蓝色外套",
      voiceId: "PRIVATE_VOICE",
    },
    { ...film.characters[1]!, id: "person-two", name: "林夏之友", identity: "白色衬衣" },
  ];
  Object.assign(film.characters[0]!, { referenceImage: "/private/media.png" });
  film.shots = film.shots.map((shot, i) => ({ ...shot, sceneId: film.scenes[0]!.id, no: i + 1 }));
  const selection = {
    projectId: film.id,
    page: "board" as const,
    sceneId: film.scenes[0]!.id,
    shotId: film.shots[0]!.id,
  };
  return { film, selection };
}
it("resolves complete exact long names and current-scene shot numbers, without changing the chosen editing target", () => {
  const { film, selection } = setup();
  const result = captureAssistantReferences(
    film,
    selection,
    "参考@林夏之友，和 @镜头 2。",
    "action",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.capture.labels).toEqual(["林夏之友", "镜头 2"]);
  expect(result.capture.selection.shotId).toBe(film.shots[0]!.id);
  expect(JSON.parse(result.capture.context).taskScope).toBe("shot");
  expect(JSON.parse(result.capture.context).references[1].no).toBe(2);
});
it("quoted menu tokens preserve spaces, quotes and names that look like shot references", () => {
  const { film, selection } = setup();
  film.characters[0]!.name = '镜头1 的"很长"名字';
  const item = referenceCandidates(film, film.shots)[0]!;
  expect(item.token).toBe(`@${JSON.stringify(film.characters[0]!.name)}`);
  const result = captureAssistantReferences(film, selection, `${item.token} 请看一下`, "art");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.capture.targets).toEqual([{ kind: "character", id: film.characters[0]!.id }]);
  expect(JSON.parse(result.capture.context).taskScope).toBe("project");
});
it.each(["@林夏之友们", "@镜头2号", "@镜头999", "@不存在"])(
  "rejects unknown full token %s rather than accepting a shorter prefix",
  (text) => {
    const { film, selection } = setup();
    expect(captureAssistantReferences(film, selection, text, "director")).toEqual({
      ok: false,
      code: "ASSISTANT_REFERENCE_UNKNOWN",
    });
  },
);
it.each(['@"没结束', "@", '@"林夏"后缀'])(
  "rejects unfinished or boundary-invalid syntax %s",
  (text) => {
    const { film, selection } = setup();
    expect(captureAssistantReferences(film, selection, text, "writer")).toMatchObject({
      ok: false,
    });
  },
);
it("does not reinterpret email addresses or ordinary text as reference directives", () => {
  const { film, selection } = setup();
  const result = captureAssistantReferences(
    film,
    selection,
    "发邮件给 user@example.com，画面里保留 a+b@demo.test。",
    "writer",
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.capture.targets).toEqual([]);
  film.scenes = [];
  expect(
    captureAssistantReferences(
      film,
      { ...selection, sceneId: undefined, shotId: undefined },
      "先写全文",
      "writer",
    ).ok,
  ).toBe(true);
});
it("rejects duplicate person names and duplicate current-scene numbers, but not another scene's same number", () => {
  const { film, selection } = setup();
  film.characters[1]!.name = film.characters[0]!.name;
  expect(captureAssistantReferences(film, selection, "@林夏", "art")).toEqual({
    ok: false,
    code: "ASSISTANT_REFERENCE_AMBIGUOUS",
  });
  expect(referenceCandidates(film, film.shots)[0]!.disabled).toBe(true);
  film.shots[1]!.no = film.shots[0]!.no;
  expect(captureAssistantReferences(film, selection, "@镜头1", "action")).toEqual({
    ok: false,
    code: "ASSISTANT_REFERENCE_AMBIGUOUS",
  });
  film.shots[1]!.sceneId = film.scenes[1]!.id;
  expect(captureAssistantReferences(film, selection, "@镜头1", "action").ok).toBe(true);
});
it("projects explicit text fields only, never entity IDs, media, voice bindings or user metadata objects", () => {
  const { film, selection } = setup();
  const result = captureAssistantReferences(film, selection, "@林夏 @镜头1", "performance");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.capture.context).toContain("蓝色外套");
  for (const forbidden of ["PRIVATE_VOICE", "/private/media", "person-one", film.shots[0]!.id])
    expect(result.capture.context).not.toContain(forbidden);
});
it("binds referenced identities/text and scope while allowing unrelated media arrival and save metadata", () => {
  const { film, selection } = setup();
  const result = captureAssistantReferences(film, selection, "@林夏 @镜头1", "action");
  if (!result.ok) throw Error("fixture reference failed");
  const media = structuredClone(film);
  media.savedAt = "later";
  media.shots[0]!.takes.push({
    id: "late-media",
    shotId: media.shots[0]!.id,
    index: 1,
    status: "done",
    videoPath: "/new/media.mp4",
    videoUrl: "",
    stillUrl: "",
    createdAt: "",
    prompt: "",
    reason: "",
  });
  expect(assistantReferencesCurrent(result.capture, media, selection)).toBe(true);
  for (const mutate of [
    (f: typeof film) => {
      f.characters[0]!.name = "新名字";
    },
    (f: typeof film) => {
      f.characters.shift();
    },
    (f: typeof film) => {
      f.shots[0]!.picture += "新画面";
    },
  ]) {
    const changed = structuredClone(film);
    mutate(changed);
    expect(assistantReferencesCurrent(result.capture, changed, selection)).toBe(false);
  }
  expect(
    assistantReferencesCurrent(result.capture, film, { ...selection, sceneId: film.scenes[1]!.id }),
  ).toBe(false);
  expect(
    assistantReferencesCurrent(
      result.capture,
      { ...film, id: "other" },
      { ...selection, projectId: "other" },
    ),
  ).toBe(false);
});

it("keeps existing place references clickable and projects only actual text, rejecting cross-kind name collisions", () => {
  const { film, selection } = setup();
  film.locations = [
    {
      id: "place-reference",
      name: "旧书店",
      prompt: "狭长木架",
      ambience: "安静",
      layout: "门在左侧",
      referenceImage: "/private/place.png",
    },
  ];
  Object.assign(film.locations[0]!, { secret: "PRIVATE_ACCOUNT" });
  const menu = referenceCandidates(film, film.shots).find((item) => item.token === "@旧书店")!;
  expect(menu.disabled).toBe(false);
  const result = captureAssistantReferences(film, selection, menu.token, "art");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(JSON.parse(result.capture.context).references).toEqual([
    { kind: "location", name: "旧书店", prompt: "狭长木架", ambience: "安静", layout: "门在左侧" },
  ]);
  expect(result.capture.context).not.toMatch(/PRIVATE_ACCOUNT|private|place-reference/);
  const changed = structuredClone(film);
  changed.locations[0]!.name = "新书店";
  expect(assistantReferencesCurrent(result.capture, changed, selection)).toBe(false);
  changed.locations = [];
  expect(assistantReferencesCurrent(result.capture, changed, selection)).toBe(false);
  film.characters[0]!.name = "旧书店";
  expect(captureAssistantReferences(film, selection, "@旧书店", "art")).toEqual({
    ok: false,
    code: "ASSISTANT_REFERENCE_AMBIGUOUS",
  });
});
it("rejects a referenced shot that moved out of the captured scene even if its text stayed equal", () => {
  const { film, selection } = setup();
  const result = captureAssistantReferences(film, selection, "@镜头2", "action");
  if (!result.ok) throw Error("fixture reference failed");
  film.shots[1]!.sceneId = film.scenes[1]!.id;
  expect(assistantReferencesCurrent(result.capture, film, selection)).toBe(false);
});
