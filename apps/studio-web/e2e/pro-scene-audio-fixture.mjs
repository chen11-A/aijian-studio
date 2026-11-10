/** Controlled scene ABI: no file copy, decoder, provider or listening assertion. */
export function seedSceneAudioProject() {
  const id = window.localStorage.getItem("aivora.film.activeId");
  const raw = JSON.parse(window.localStorage.getItem(`aivora.film.v1.${id}`));
  for (const shot of raw.shots) shot.sceneId = raw.scenes[0].id;
  for (const key of ["aivora.film.active", `aivora.film.v1.${id}`])
    window.localStorage.setItem(key, JSON.stringify(raw));
  return { sceneId: raw.scenes[0].id, shotId: raw.shots[0].id };
}
export function installSceneAudioBridge({ catalog }) {
  const creation = window.__proCreationAudit,
    readonly = window.__shotAudioAudit;
  const audit = { calls: [], forbidden: [] };
  window.__sceneAudioAudit = audit;
  window.__sceneSettleAudit = { stages: [] };
  window.aijian.suggestBundledFilmSceneAudio = async (input) => {
    const raw = creation.record(input.projectId),
      rows = raw?.shots.map((s) => ({ shotId: s.id, takeId: s.selectedTakeId }));
    const matched =
      !!raw &&
      Object.keys(input).sort().join() ===
        "expectedProjectHash,expectedSelection,projectId,sceneId" &&
      raw.scenes.filter((s) => s.id === input.sceneId).length === 1 &&
      JSON.stringify(input.expectedSelection) === JSON.stringify(rows);
    if (!matched) {
      audit.forbidden.push("scene-suggest-input");
      throw Error("INVALID_SCENE_AUDIT_INPUT");
    }
    const currentHash = await creation.hash(raw),
      hashMatches = input.expectedProjectHash === currentHash;
    audit.calls.push({
      input: globalThis.structuredClone(input),
      matched: hashMatches,
      reply: hashMatches ? "SCENE_SUGGESTED" : "PROJECT_CHANGED",
    });
    if (!hashMatches) return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    const assets = catalog.assets.filter((a) => a.durationSeconds > 5);
    const fx = assets.find((a) => a.type === "sfx"),
      music = assets.find((a) => a.type === "music");
    if (!fx || !music || catalog.assets.length !== 206) throw Error("INVALID_SCENE_AUDIT_CATALOG");
    const clock = {
      durationSeconds: raw.shots.length * 2.25,
      shots: raw.shots.map((s, i) => ({
        shotId: s.id,
        takeId: s.selectedTakeId,
        sceneId: s.sceneId,
        startSeconds: i * 2.25,
        durationSeconds: 2.25,
      })),
    };
    const target = clock.shots.filter((s) => s.sceneId === input.sceneId);
    return {
      kind: "SCENE_SUGGESTED",
      projectId: raw.id,
      projectHash: input.expectedProjectHash,
      sceneId: input.sceneId,
      catalogSha256: catalog.manifestSha256,
      pickerSha256: "b".repeat(64),
      planFingerprint: "c".repeat(64),
      clock,
      sceneStartSeconds: target[0].startSeconds,
      sceneDurationSeconds: target.length * 2.25,
      sceneAudioBinding: {
        schemaVersion: 1,
        sceneId: input.sceneId,
        selectionSha256: "f".repeat(64),
      },
      clips: ["ambience", "ambience", "sfx", "sfx", "score", "score"].map((lane, i) => ({
        key: `scene-segment-${i}`,
        lane,
        shotId: target[i % target.length].shotId,
        takeId: target[i % target.length].takeId,
        asset: globalThis.structuredClone(lane === "score" ? music : fx),
        placement: {
          startSeconds: 0.125,
          durationSeconds: 0.5,
          offsetSeconds: (i % 2) * 0.5,
          gainDb: -30,
          loop: false,
        },
        envelope: {
          schemaVersion: 1,
          baseGainDb: -25,
          fades: [
            { direction: "in", startSeconds: -0.1, durationSeconds: 0.2 },
            { direction: "out", startSeconds: 0.4, durationSeconds: 0.1 },
          ],
          gainAutomation: [
            { startSeconds: 0, endSeconds: 0.25, gainDb: -32 },
            { startSeconds: 0.25, endSeconds: 0.5, gainDb: -28 },
          ],
        },
        reason: "合成整场片段，按实际时钟映射到本镜，不代表听过。",
      })),
      warnings: Array.from({ length: 5 }, (_, i) => ({
        code: i === 0 ? "SCENE_MUSIC_MOOD_CONFLICT" : "MATCH_MISSING",
        shotIndex: i,
        message: `整场提醒${i + 1}：${"文字和本地匹配仍需人工核对，不自动补声音。".repeat(12)}`,
      })),
      limitations: Array.from({ length: 5 }, (_, i) => ({
        code: "PLANNED_TIMES_ONLY",
        shotIndex: i,
        message: `整场限制${i + 1}：${"这不是成片动作或听感审核，也没有试听。".repeat(12)}`,
      })),
    };
  };
  // Expose only fixed synthetic counters for assertions; the readonly preview adapter remains intact.
  audit.readonly = readonly;
}

/** Closed diagnostic observations only; never returns DOM text, opaque IDs, hash or paths. */
export function readSceneAudioApplyState() {
  const group = window.__audioGroupsAudit,
    last = group?.calls.at(-1),
    text = window.document.querySelector(".shot-audio-suggestions")?.textContent ?? "";
  return {
    calls: group?.calls.length ?? 0,
    matched: typeof last?.matched === "boolean" ? last.matched : null,
    casMatched: typeof last?.casMatched === "boolean" ? last.casMatched : null,
    reviewMatched: typeof last?.reviewMatched === "boolean" ? last.reviewMatched : null,
    initialCas: typeof last?.initialCas === "boolean" ? last.initialCas : null,
    finalCas: typeof last?.finalCas === "boolean" ? last.finalCas : null,
    reply: [
      "PENDING",
      "REJECTED",
      "TRANSPORT_UNKNOWN",
      "ADDED",
      "PROJECT_CHANGED",
      "UNKNOWN",
    ].includes(last?.reply)
      ? last.reply
      : "UNKNOWN",
    nativeWrites: group?.nativeWrites ?? 0,
    pending: group?.pending.length ?? 0,
    saved: text.includes("声音已加入并保存"),
    rebased: text.includes("素材已加入原版本，保留了本页后来的编辑"),
    stale:
      text.includes("本场内容已变化，本次没有选用") ||
      text.includes("当前编辑又有变化") ||
      text.includes("场次、选版或素材已变化，请刷新后重新核对。"),
    unknown: [...window.document.querySelectorAll("button")].some((button) =>
      /^本地素材保存待核对（[1-9]\d{0,3}）$/.test(button.textContent.trim()),
    ),
    settle: (window.__sceneSettleAudit?.stages ?? []).filter((stage) =>
      [
        "clear",
        "call",
        "lease",
        "lease-none",
        "write-success",
        "write-other",
        "keep-result",
        "invalidate",
      ].includes(stage),
    ),
  };
}
