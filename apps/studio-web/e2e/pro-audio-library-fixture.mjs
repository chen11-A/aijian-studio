/** Native ABI simulation only. Metadata is the real public catalog; no real files/decoding. */
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { createHash } from "node:crypto";
export async function loadLibraryAuditCatalog() {
  const bytes = await readFile(
    new URL("../../../assets/audio-library/manifest.json", import.meta.url),
  );
  return {
    kind: "CATALOG",
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    assets: JSON.parse(bytes).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      category: row.category,
      tags: row.tags,
      scene: row.scene,
      durationSeconds: row.duration,
      loopable: row.loop,
      loudness: row.loudness,
      source: row.source,
      author: row.author,
      license: row.license,
      sha256: row.sha256,
    })),
  };
}
export function installAudioLibraryBridge({ state, catalog }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const native = window.aijian,
    creation = window.__proCreationAudit;
  const raw = (id) => creation.record(id);
  const store = (film) =>
    window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
  const audit = {
    catalog: 0,
    writes: [],
    inspects: [],
    adds: [],
    previews: [],
    waves: [],
    forbidden: [],
    pendingTargets: [],
    active: false,
    mode: state === "library-target-guard" ? "hold-target" : "ready",
    files: {},
    duration: 2.25,
  };
  window.__proAudioLibraryAudit = audit;
  const fail = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_AUDIO_LIBRARY_DISPATCH");
  };
  for (const name of [
    "exportFilmProjectArchive",
    "importFilmProjectArchive",
    "publishFilmExport",
    "discardFilmExport",
    "prepareFilmExport",
    "importMusic",
  ])
    native[name] = async () => fail(name);
  native.writeFilmProject = async (film) => {
    const value = clone(film);
    store(value);
    if (window.localStorage.getItem("aivora.film.activeId") === value.id)
      window.localStorage.setItem("aivora.film.active", JSON.stringify(value));
    audit.writes.push({ projectId: value.id, hash: await creation.hash(value) });
    return clone(value);
  };
  native.listBundledFilmAudio = async () => {
    audit.catalog++;
    return clone(catalog);
  };
  const validTarget = async (input) => {
    const film = raw(input.projectId),
      shot = film?.shots.find((s) => s.id === input.shotId);
    return (
      Object.keys(input).sort().join() === "expectedProjectHash,projectId,shotId,takeId" &&
      !!shot &&
      shot.selectedTakeId === input.takeId &&
      input.expectedProjectHash === (await creation.hash(film))
    );
  };
  native.inspectBundledFilmAudioTarget = async (input) => {
    const matched = await validTarget(input);
    const call = { input: clone(input), matched, busy: audit.active, reply: "PENDING" };
    audit.inspects.push(call);
    const reply = (result) => {
      call.reply = result.kind === "TARGET" ? "TARGET" : result.code;
      return result;
    };
    if (audit.active) return reply({ kind: "FAILED", code: "BUSY", unchanged: true });
    if (!matched) return reply({ kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true });
    if (audit.mode === "hold-target")
      return new Promise((resolve) => {
        audit.pendingTargets.push({ resolve: (result) => resolve(reply(result)) });
        audit.targetAdmitted?.();
      });
    if (audit.mode === "target-failed")
      return reply({ kind: "FAILED", code: "SOURCE_UNVERIFIED", unchanged: true });
    return reply({
      kind: "TARGET",
      projectId: input.projectId,
      shotId: input.shotId,
      takeId: input.takeId,
      projectHash: input.expectedProjectHash,
      durationSeconds: audit.duration,
    });
  };
  audit.resolveTarget = () => {
    const pending = audit.pendingTargets.shift();
    if (!pending) throw Error("MISSING_TARGET_ADMISSION");
    audit.mode = "target-failed";
    pending.resolve({ kind: "FAILED", code: "SOURCE_UNVERIFIED", unchanged: true });
  };
  const commit = async (input) => {
    const film = clone(raw(input.projectId)),
      asset = catalog.assets.find((a) => a.id === input.assetId);
    const clip = {
      id: "audio-library-browser-added",
      lane: input.lane,
      label: asset.name,
      shotId: input.shotId,
      takeId: input.takeId,
      path: "/synthetic/library/copied-asset.ogg",
      ...input.placement,
      enabled: true,
      libraryAsset: {
        assetId: asset.id,
        source: asset.source,
        author: asset.author,
        license: asset.license,
        sha256: asset.sha256,
        loopable: asset.loopable,
        loudness: asset.loudness,
      },
    };
    film.audioClips = [...film.audioClips, clip];
    store(film);
    audit.files[clip.path] = asset.sha256;
    audit.active = false;
    return { kind: "ADDED", clipId: clip.id, project: clone(film) };
  };
  native.addBundledFilmAudio = async (input) => {
    const { catalogSha256, assetId, expectedAssetSha256, lane, placement, ...target } = input;
    const asset = catalog.assets.find((a) => a.id === assetId);
    const matched =
      (await validTarget(target)) &&
      catalogSha256 === catalog.manifestSha256 &&
      expectedAssetSha256 === asset?.sha256 &&
      ["ambience", "sfx", "score"].includes(lane) &&
      placement.startSeconds >= 0 &&
      placement.offsetSeconds >= 0 &&
      placement.durationSeconds > 0 &&
      placement.startSeconds + placement.durationSeconds <= audit.duration &&
      placement.gainDb >= -24 &&
      placement.gainDb <= 12 &&
      (!placement.loop || asset.loopable) &&
      (placement.loop ||
        placement.offsetSeconds + placement.durationSeconds <= asset.durationSeconds);
    audit.adds.push({ input: clone(input), matched });
    if (!matched) return fail("unverified-add-input");
    if (audit.active) return fail("duplicate-active-add");
    audit.active = true;
    if (state === "library-unknown-recovery") {
      audit.pendingInput = clone(input);
      throw Error("SYNTHETIC_TRANSPORT_UNKNOWN");
    }
    return commit(input);
  };
  audit.finish = async () => {
    if (!audit.pendingInput) throw Error("MISSING_ADD_ADMISSION");
    const result = await commit(audit.pendingInput);
    const film = raw(result.project.id);
    film.title = "本机后来保存的片名";
    store(film);
    return result;
  };
  native.getFilmAudioMixPreview = async (input) => {
    const matched =
      Object.keys(input).sort().join() === "expectedHash,projectId" &&
      input.expectedHash === (await creation.hash(raw(input.projectId)));
    audit.previews.push({ matched });
    if (!matched) return fail("unverified-preview-input");
    return { kind: "FAILED", code: "SOURCE_UNVERIFIED" };
  };
  native.readFilmAudioWaveform = async (input) => {
    const film = raw(input.projectId);
    const matched = !!film?.audioClips.find((c) => c.id === input.clipId);
    audit.waves.push({ matched });
    if (!matched) return fail("unverified-waveform-input");
    return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
  };
}
