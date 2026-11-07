/** Synthetic text/native ABI for real Pro references. No provider/network/media execution. */
export function seedMentionsProject({ state }) {
  const film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  const name = "合成参考人物名字很长但必须完整匹配",
    place = "旧书店 南侧";
  film.characters = [
    {
      ...film.characters[0],
      name,
      identity: "短发，蓝色外套，人物身份保持一致。",
      gender: "",
      ageBand: "",
      userFields: [],
    },
  ];
  Object.assign(film.characters[0], { privateAccount: "SYNTHETIC_REFERENCE_PRIVATE" });
  if (state === "refs-invalid")
    film.characters.push({ ...film.characters[0], id: "mentions-duplicate-person" });
  film.locations = [
    {
      id: "mentions-place",
      name: place,
      prompt: "木架与石阶",
      ambience: "安静",
      layout: "门在左侧",
      referenceImage: film.shots[0].poster,
    },
  ];
  film.props = [];
  film.costumes = [];
  film.jobs = [];
  film.audioClips = [];
  film.scenes = film.scenes.slice(0, 2);
  film.scenes[0].title = "合成参考场 · 木门前";
  film.scenes[1].title = "保留媒体场";
  film.scenes[0].text = `${name}走到木门前，转身停住。`;
  film.scenes[0].where = place;
  film.scenes[0].tags = [];
  film.scenes[1].text = "另一场的画面和视频版本保留。";
  film.sourceText = film.scenes.map((s) => s.text).join("\n");
  film.shots = film.shots.map((s, i) => ({
    ...s,
    sceneId: film.scenes[i < 2 ? 0 : 1].id,
    no: i < 2 ? i + 1 : i - 1,
    characters: [name],
    line: "",
    lines: [],
    speaker: "",
    userFields: [],
    source: "agent:director",
    actionBeats: [],
    action: "",
    performance: "",
    ...(i < 2
      ? {
          id: `mentions-original-${i + 1}`,
          poster: "",
          stills: [],
          takes: [],
          selectedTakeId: "",
          continuityFromShotId: undefined,
          continuityFrame: undefined,
        }
      : {}),
  }));
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  const text = JSON.stringify(film);
  window.localStorage.setItem("aivora.film.active", text);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, text);
  return {
    projectId: film.id,
    sceneId: film.scenes[0].id,
    firstShotId: film.shots[0].id,
    person: name,
    place,
    personToken: `@${name}`,
    placeToken: `@${JSON.stringify(place)}`,
  };
}
export function installMentionsBridge({ state }) {
  const creation = window.__proCreationAudit,
    bridge = window.aijian;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const audit = {
    requests: [],
    forbidden: [],
    pending: [],
    writes: [],
    expected: null,
    hold: state === "refs-stale",
  };
  window.__proMentionsAudit = audit;
  const write = bridge.writeFilmProject;
  bridge.writeFilmProject = async (value) => {
    const result = await write(value);
    audit.writes.push(clone(result));
    return result;
  };
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_REFERENCE_DISPATCH");
  };
  audit.expect = (value) => {
    audit.expected = clone(value);
  };
  audit.release = (index) => {
    if (!audit.pending[index]) throw Error("REFERENCE_PENDING_MISSING");
    audit.pending[index].resolve();
  };
  audit.saved = () => creation.saved();
  window.aijianGrok.completeText = async (input) => {
    if (!["art", "director", "performance", "action"].includes(input.agent))
      return forbidden("agent");
    const line = input.text.split("\n").find((value) => value.startsWith('{"userRequest":'));
    let context;
    try {
      context = JSON.parse(line);
    } catch {
      return forbidden("context");
    }
    const expected = audit.expected;
    if (
      !expected ||
      input.projectId !== creation.saved().backendProjectId ||
      context.userRequest !== expected.userRequest ||
      context.taskScope !== expected.scope
    )
      return forbidden("scope");
    const keys = {
      character: ["kind", "name", "identity", "gender", "ageBand"],
      location: ["kind", "name", "prompt", "ambience", "layout"],
      shot: [
        "kind",
        "no",
        "size",
        "picture",
        "action",
        "actionBeats",
        "performance",
        "characters",
        "line",
        "speaker",
        "lines",
      ],
    };
    if (
      !Array.isArray(context.references) ||
      context.references.some(
        (r) => !keys[r.kind] || Object.keys(r).some((k) => !keys[r.kind].includes(k)),
      ) ||
      JSON.stringify(context).includes("SYNTHETIC_REFERENCE_PRIVATE")
    )
      return forbidden("projection");
    const film = clone(creation.saved());
    const text =
      input.agent === "art"
        ? JSON.stringify({
            prompt_block_zh: "克制的冷色电影画风，柔和侧光，材质和人物身份保持一致。".repeat(8),
          })
        : input.agent === "director"
          ? JSON.stringify({
              shots: [
                { picture: film.scenes[0].text, characters: [film.characters[0].name], seconds: 3 },
              ],
            })
          : "[]";
    audit.requests.push({
      agent: input.agent,
      context: clone(context),
      projectId: input.projectId,
    });
    if (audit.hold) await new Promise((resolve) => audit.pending.push({ resolve }));
    return { kind: "OK", text };
  };
}
