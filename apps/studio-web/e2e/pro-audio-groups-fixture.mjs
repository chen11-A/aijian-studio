/** Controlled apply ABI, not real media copying, planner authorization or playback. */
export function installAudioGroupsBridge({ state, helperModuleUrl }) {
  const clone = (value) => JSON.parse(JSON.stringify(value)),
    bridge = window.aijian,
    creation = window.__proCreationAudit,
    readonly = window.__shotAudioAudit;
  const raw = (id) => creation.record(id),
    store = (value) =>
      window.localStorage.setItem(`aivora.film.v1.${value.id}`, JSON.stringify(value));
  const audit = {
    calls: [],
    inspects: [],
    previews: [],
    writes: [],
    nativeWrites: 0,
    copied: {},
    pending: [],
    active: false,
    forbidden: [],
    mode:
      state === "audio-groups-busy"
        ? "hold"
        : state === "audio-groups-unknown"
          ? "transport"
          : state === "audio-groups-partial-conflict"
            ? "partial-ack"
            : "success",
    serial: 0,
    review: null,
  };
  window.__audioGroupsAudit = audit;
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_GROUP_EXECUTION_DISPATCH");
  };
  // Ordinary background saves must not pretend to select a different work.
  bridge.writeFilmProject = async (film) => {
    const value = clone(film);
    store(value);
    if (window.localStorage.getItem("aivora.film.activeId") === value.id)
      window.localStorage.setItem("aivora.film.active", JSON.stringify(value));
    readonly.writes++;
    audit.writes.push({ projectId: value.id, hash: await creation.hash(value) });
    return clone(value);
  };
  const preview = bridge.getFilmAudioMixPreview;
  bridge.getFilmAudioMixPreview = async (input) => {
    const result = await preview(input);
    audit.previews.push({
      projectId: input.projectId,
      expectedHash: input.expectedHash,
      kind: result.kind,
    });
    return result;
  };
  const suggest = bridge.suggestBundledFilmShotAudio;
  bridge.suggestBundledFilmShotAudio = async (input) => {
    const result = await suggest(input);
    if (result.kind === "SUGGESTED")
      audit.review = { plan: clone(result), raw: raw(input.projectId) };
    return result;
  };
  bridge.inspectBundledFilmAudioTarget = async (input) => {
    const shape =
      Object.keys(input).sort().join() === "expectedProjectHash,projectId,shotId,takeId";
    if (!shape) return forbidden("inspect-shape");
    if (audit.active) {
      audit.inspects.push({ reply: "BUSY" });
      return { kind: "FAILED", code: "BUSY", unchanged: true };
    }
    const value = raw(input.projectId),
      shot = value?.shots.find((s) => s.id === input.shotId);
    const matched =
      !!shot &&
      shot.selectedTakeId === input.takeId &&
      (await creation.hash(value)) === input.expectedProjectHash;
    audit.inspects.push({ reply: matched ? "TARGET" : "PROJECT_CHANGED" });
    return matched
      ? {
          kind: "TARGET",
          projectId: input.projectId,
          shotId: input.shotId,
          takeId: input.takeId,
          projectHash: input.expectedProjectHash,
          durationSeconds: 2.25,
        }
      : { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
  };
  const body = (record) =>
    Object.fromEntries(
      Object.entries(record).filter(([key]) => !["savedAt", "directory"].includes(key)),
    );
  const helpers = () => (audit.helpers ??= import(helperModuleUrl));
  const commit = async (request) => {
    const current = raw(request.input.projectId);
    if ((await creation.hash(current)) !== request.input.expectedProjectHash) {
      audit.active = false;
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    }
    const { audioSuggestionMemberInput, audioSuggestionMemberSetInput, digestGroupText } =
      await helpers();
    const serial = ++audit.serial,
      selected = request.plan.clips.filter((c) => request.input.lanes.includes(c.lane));
    const clips = selected.map((segment, i) => {
      const a = segment.asset;
      const path = `/synthetic/audio-groups/${serial}/${a.id}.ogg`;

      return {
        id: `group-${serial}-clip-${i}`,
        shotId: request.input.shotId,
        takeId: request.input.takeId,
        lane: segment.lane,
        label: a.name,
        ...segment.placement,
        ...(segment.envelope ? { envelope: clone(segment.envelope) } : {}),
        enabled: true,
        path,
        libraryAsset: {
          assetId: a.id,
          sha256: a.sha256,
          source: a.source,
          author: a.author,
          license: a.license,
          loopable: a.loopable,
          loudness: a.loudness,
        },
      };
    });
    const members = await Promise.all(
      clips.map(async (clip, i) => ({
        key: selected[i].key,
        clipId: clip.id,
        creativeSha256: await digestGroupText(audioSuggestionMemberInput(clip)),
      })),
    );
    const receipt = {
      schemaVersion: 1,
      groupId: `audio-group-exec-${serial}`,
      planFingerprint: request.input.planFingerprint,
      memberCount: members.length,
      memberSetSha256: await digestGroupText(audioSuggestionMemberSetInput(members)),
      members,
    };
    const project = {
      ...current,
      audioClips: [
        ...current.audioClips,
        ...clips.map((clip, i) => ({
          ...clip,
          suggestionGroup: {
            schemaVersion: 1,
            groupId: receipt.groupId,
            planFingerprint: receipt.planFingerprint,
            key: members[i].key,
            memberCount: receipt.memberCount,
            memberSetSha256: receipt.memberSetSha256,
          },
        })),
      ],
    };
    // Mirror native's final CAS after all asynchronous digest work. No staged
    // file registry or canonical record is committed when this check fails.
    if ((await creation.hash(raw(request.input.projectId))) !== request.input.expectedProjectHash) {
      audit.active = false;
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    }
    for (const clip of clips) audit.copied[clip.path] = clip.libraryAsset.sha256;
    store(project);
    audit.nativeWrites++;
    audit.active = false;
    return { kind: "ADDED", project: clone(project), receipt };
  };
  bridge.applyBundledFilmShotAudio = async (input) => {
    const review = audit.review,
      value = raw(input.projectId),
      shot = value?.shots.find((s) => s.id === input.shotId);
    const matched =
      !!review &&
      Object.keys(input).sort().join() ===
        "catalogSha256,expectedProjectHash,lanes,pickerSha256,planFingerprint,projectId,shotId,takeId" &&
      input.expectedProjectHash === (await creation.hash(value)) &&
      input.projectId === review.plan.projectId &&
      input.shotId === review.plan.shotId &&
      input.takeId === review.plan.takeId &&
      shot?.selectedTakeId === input.takeId &&
      input.catalogSha256 === review.plan.catalogSha256 &&
      input.pickerSha256 === review.plan.pickerSha256 &&
      input.planFingerprint === review.plan.planFingerprint &&
      Array.isArray(input.lanes) &&
      input.lanes.length > 0 &&
      new Set(input.lanes).size === input.lanes.length &&
      input.lanes.every(
        (l) =>
          ["ambience", "sfx", "score"].includes(l) && review.plan.clips.some((c) => c.lane === l),
      ) &&
      (await creation.hash(body(value))) === (await creation.hash(body(review.raw)));
    audit.calls.push({ input: clone(input), matched });
    if (!matched || audit.active) return forbidden("apply-input-or-duplicate");
    audit.active = true;
    const request = { input: clone(input), plan: clone(review.plan) };
    if (audit.mode === "transport") {
      audit.unknown = request;
      throw Error("SYNTHETIC_GROUP_TRANSPORT_UNKNOWN");
    }
    if (audit.mode === "hold")
      return new Promise((resolve) => {
        audit.pending.push({ request, resolve });
        audit.admitted?.();
      });
    const result = await commit(request);
    return audit.mode === "partial-ack" && result.kind === "ADDED"
      ? { ...result, receipt: { ...result.receipt, members: result.receipt.members.slice(0, -1) } }
      : result;
  };
  audit.finish = async () => {
    const pending = audit.pending.shift(),
      request = pending?.request ?? audit.unknown;
    if (!request) throw Error("MISSING_GROUP_ADMISSION");
    const result = await commit(request);
    audit.unknown = null;
    pending?.resolve(result);
    audit.mode = "success";
    return result;
  };
}
