/** Synthetic configuration ABI only; no API, provider, native file or billing operation. */
export function installStoryPolicyBridge({ state }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const audit = {
    reads: [],
    writes: [],
    pending: [],
    forbidden: [],
    policies: {},
    videoReads: [],
    filmWrites: [],
    unknownReads: 0,
    heldReads: false,
  };
  window.__storyPolicyAudit = audit;
  const policy = (id) =>
    audit.policies[id] ?? {
      state: "UNCONFIGURED",
      revision: 0,
      failure_limit: null,
      scope: "GROK_STORY_CREATION_FAILURES",
    };
  const validId = (id) => /^prj_[0-9a-f]{32}$/.test(id);
  const fail = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_RISK_POLICY_DISPATCH");
  };
  const bridge = window.aijian;
  const writeFilmProject = bridge.writeFilmProject;
  if (writeFilmProject)
    bridge.writeFilmProject = async (value) => {
      const result = await writeFilmProject(value);
      audit.filmWrites.push({ projectId: value.id });
      return result;
    };
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
    audit.videoReads.push(id);
    return {
      kind: "POLICY",
      policy: {
        state: "CONFIGURED",
        revision: 4,
        failure_limit: 77,
        scope: "GROK_VIDEO_SUBMIT_FAILURES",
      },
    };
  };
  bridge.configureGenerationFailurePolicy = async () => fail("videoWrite");
  bridge.getStoryCreationFailurePolicy = async (id) => {
    if (!validId(id)) return fail("invalidProject");
    audit.reads.push({ projectId: id });
    if (state === "story-policy-unknown" && audit.writes.length && audit.unknownReads++ === 0)
      return { kind: "FAILED", code: "WRITE_UNCONFIRMED" };
    if (audit.heldReads)
      await new Promise((resolve) =>
        audit.pending.push({ resolve, released: false, kind: "read" }),
      );
    return { kind: "POLICY", policy: clone(policy(id)) };
  };
  bridge.configureStoryCreationFailurePolicy = async (id, input) => {
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
    if (state === "story-policy-conflict" && audit.writes.length === 1) {
      audit.policies[id] = {
        state: "CONFIGURED",
        revision: 1,
        failure_limit: 5,
        scope: "GROK_STORY_CREATION_FAILURES",
      };
      return { kind: "FAILED", code: "POLICY_CHANGED" };
    }
    if (input.expected_revision !== policy(id).revision)
      return { kind: "FAILED", code: "POLICY_CHANGED" };
    audit.policies[id] = {
      state: "CONFIGURED",
      revision: policy(id).revision + 1,
      failure_limit: input.failure_limit,
      scope: "GROK_STORY_CREATION_FAILURES",
    };
    if (state === "story-policy-unknown" && audit.writes.length === 1)
      return { kind: "FAILED", code: "WRITE_UNCONFIRMED" };
    if (state === "story-policy-session" && audit.writes.length === 1)
      await new Promise((resolve) => audit.pending.push({ resolve, released: false }));
    return { kind: "POLICY", policy: clone(policy(id)) };
  };
}
