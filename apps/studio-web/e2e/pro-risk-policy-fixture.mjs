/** Synthetic configuration ABI only; no API, provider, native file or billing operation. */
export function installRiskPolicyBridge({ state }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const audit = {
    reads: [],
    writes: [],
    pending: [],
    forbidden: [],
    policies: {},
  };
  window.__proRiskPolicyAudit = audit;
  const policy = (id) =>
    audit.policies[id] ?? {
      state: "UNCONFIGURED",
      revision: 0,
      failure_limit: null,
      scope: "GROK_VIDEO_SUBMIT_FAILURES",
    };
  const validId = (id) => /^prj_[0-9a-f]{32}$/.test(id);
  const fail = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_RISK_POLICY_DISPATCH");
  };
  const bridge = window.aijian;
  bridge.createProject = async () => fail("createProject");
  for (const name of [
    "createStoryFilm",
    "createFilmVideo",
    "generateFilmRange",
    "prepareFilmRange",
    "submitGeneration",
    "assembleFilm",
    "assembleFilmProject",
  ])
    bridge[name] = async () => fail(name);
  window.aijianGrok.completeText = async () => fail("completeText");
  window.aijianGrok.generateVideo = async () => fail("generateVideo");
  window.aijianGrok.speak = async () => fail("speak");
  audit.release = (index) => {
    const entry = audit.pending[index];
    if (!entry || entry.released) throw Error("POLICY_PENDING_MISSING");
    entry.released = true;
    entry.resolve();
  };
  bridge.getGenerationFailurePolicy = async (id) => {
    if (!validId(id)) return fail("invalidProject");
    audit.reads.push({ projectId: id });
    return { kind: "POLICY", policy: clone(policy(id)) };
  };
  bridge.configureGenerationFailurePolicy = async (id, input) => {
    if (
      !validId(id) ||
      Object.keys(input).sort().join() !== "expected_revision,failure_limit" ||
      !Number.isSafeInteger(input.expected_revision) ||
      !Number.isInteger(input.failure_limit) ||
      input.failure_limit < 0 ||
      input.failure_limit > 1000
    )
      return fail("invalidConfiguration");
    audit.writes.push({ projectId: id, input: clone(input) });
    if (state === "policy-conflict" && audit.writes.length === 1) {
      audit.policies[id] = {
        state: "CONFIGURED",
        revision: 1,
        failure_limit: 5,
        scope: "GROK_VIDEO_SUBMIT_FAILURES",
      };
      return { kind: "FAILED", code: "POLICY_CHANGED" };
    }
    if (input.expected_revision !== policy(id).revision)
      return { kind: "FAILED", code: "POLICY_CHANGED" };
    audit.policies[id] = {
      state: "CONFIGURED",
      revision: policy(id).revision + 1,
      failure_limit: input.failure_limit,
      scope: "GROK_VIDEO_SUBMIT_FAILURES",
    };
    if (state === "policy-unknown" && audit.writes.length === 1)
      return { kind: "FAILED", code: "WRITE_UNCONFIRMED" };
    if (state === "policy-session" && audit.writes.length === 1)
      await new Promise((resolve) => audit.pending.push({ resolve, released: false }));
    return { kind: "POLICY", policy: clone(policy(id)) };
  };
}
export function seedRiskPolicyProject({ state }) {
  const film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.jobs = [];
  film.audioClips = [];
  film.characters = film.characters.slice(0, 1);
  const person = film.characters[0];
  film.scenes[0].text = `${person.name}：检查一段完整对白。\n${person.name}走到门边。`;
  const shot = film.shots.find((s) => s.sceneId === film.scenes[0].id);
  shot.picture =
    state === "risk-long"
      ? "长画面说明需要完整显示，门的位置与人物位置都待人工核对。".repeat(70)
      : "人物站在门边。";
  shot.line = "检查一段完整对白。";
  shot.speaker = person.name;
  shot.lines = [{ speaker: person.name, text: shot.line }];
  shot.characters = [person.name];
  if (state === "risk-explicit") shot.selectedTakeId = "";
  const other = JSON.parse(JSON.stringify(film));
  other.id = "risk-policy-other-work";
  other.episodeNo = 2;
  other.episodeTitle = "合成配置第2集";
  other.backendProjectId = `prj_${"b".repeat(32)}`;
  other.styleZh = "另一作品的画风必须保留";
  window.localStorage.setItem(`aivora.film.v1.${other.id}`, JSON.stringify(other));
  const text = JSON.stringify(film);
  window.localStorage.setItem("aivora.film.active", text);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, text);
  return { projectId: film.id, shotId: shot.id, sceneId: shot.sceneId, otherId: other.id };
}
