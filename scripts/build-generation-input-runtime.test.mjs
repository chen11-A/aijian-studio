import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { buildGenerationInputRuntime } from "./build-generation-input-runtime.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(root, "apps/studio-web/package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const json = (value) => JSON.parse(JSON.stringify(value));

test("actual closed native producer preserves the editor's effective request, voices and reviews", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aivora-generation-pure-"));
  const source = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const receipt = await buildGenerationInputRuntime(directory);
    const javascript = await readFile(join(directory, "film-generation-producer.js"), "utf8");
    assert.equal(createHash("sha256").update(javascript).digest("hex"), receipt.outputSha256);
    assert.equal(receipt.runtimeImports.length, 0);
    assert.ok(receipt.sources.length > 1);
    assert.ok(receipt.sources.some((row) => row.source.endsWith("/film/operations.ts")));
    assert.ok(receipt.sources.some((row) => row.source.endsWith("/video-prompt-review.ts")));
    const exports = {};
    // No filesystem, network, renderer or source loader is supplied to the compiled
    // module. The actual generated CJS alone must produce the complete request.
    runInNewContext(javascript, { exports, URL });
    const project = await source.ssrLoadModule("/apps/studio-web/src/aivora/film/project.ts");
    const operations = await source.ssrLoadModule("/apps/studio-web/src/aivora/film/operations.ts");
    const review = await source.ssrLoadModule(
      "/apps/studio-web/src/aivora/pro/actions/video-prompt-review.ts",
    );
    const film = project.sampleFilm();
    for (const draft of [false, true]) {
      for (const shot of film.shots) {
        assert.deepEqual(
          json(exports.storyFilmBatches(film, [shot], draft)),
          json(operations.storyFilmBatches(film, [shot], draft)),
        );
        assert.equal(exports.keyframePrompt(shot, film), project.keyframePrompt(shot, film));
      }
    }
    const shot = film.shots[0];
    assert.deepEqual(
      json(exports.generationVideoBody(film, shot, shot, undefined, false)),
      json(review.generationVideoBody(film, shot, shot, undefined, false)),
    );
    const invalid = { ...shot, reviewedVideoPrompt: { text: "旧审阅", factsKey: "stale" } };
    assert.throws(() => review.generationVideoBody(film, invalid, invalid, undefined, false));
    assert.throws(() => exports.generationVideoBody(film, invalid, invalid, undefined, false));
    const seven = await source.ssrLoadModule(
      "/apps/studio-web/src/aivora/film/seven-part-video.ts",
    );
    const queue = await source.ssrLoadModule(
      "/apps/studio-web/src/aivora/film/generation-queue.ts",
    );
    const clean = project.sampleFilm();
    clean.characters = [];
    clean.props = [];
    clean.locations = [];
    clean.shots = [
      {
        ...clean.shots[0],
        characters: [],
        line: "",
        lines: [],
        picture: "空街的雨水反光。",
        action: "雨水沿路面流动。",
        performance: "",
        seconds: 4,
        userFields: ["picture", "action"],
        directorPlan: undefined,
        actionPlan: undefined,
        performancePlan: undefined,
        selectedTakeId: "",
        takes: [],
      },
    ];
    const original = clean.shots[0];
    original.reviewedVideoPrompt = seven.compileSevenPartVideo(clean, original).draft;
    for (const versions of [1, 3]) {
      const prepared = queue.prepareVideoQueue(clean, [original], versions, false);
      const current = prepared.film.shots[0];
      const first = prepared.groups[0].takes[0].id;
      assert.equal(current.selectedTakeId, first);
      assert.throws(() => exports.storyFilmBatches(prepared.film, [current], false));
      assert.deepEqual(
        json(exports.generationVideoBody(prepared.film, current, original, first, false)),
        json(review.generationVideoBody(prepared.film, current, original, first, false)),
      );
      assert.deepEqual(current.reviewedVideoPrompt, original.reviewedVideoPrompt);
      const edited = { ...current, picture: "用户实际改了画面。" };
      assert.throws(() =>
        exports.generationVideoBody(
          { ...prepared.film, shots: [edited] },
          edited,
          original,
          first,
          false,
        ),
      );
    }
    const oldTake = {
      id: "old-selected",
      shotId: original.id,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: "/synthetic/old.mp4",
      videoUrl: "",
      prompt: original.picture,
      createdAt: "2026-01-01T00:00:00Z",
      reason: "",
    };
    const old = { ...original, takes: [oldTake], selectedTakeId: oldTake.id };
    const older = { ...clean, shots: [old] };
    old.reviewedVideoPrompt = seven.compileSevenPartVideo(older, old).draft;
    const more = queue.prepareVideoQueue(older, [old], 3, false);
    const kept = more.film.shots[0];
    assert.equal(kept.selectedTakeId, oldTake.id);
    assert.deepEqual(
      json(exports.generationVideoBody(more.film, kept, old, more.groups[0].takes[0].id, false)),
      json(review.generationVideoBody(more.film, kept, old, more.groups[0].takes[0].id, false)),
    );
    assert.equal(exports.pipelineSelectedVideo(kept), oldTake.videoPath);
    const planModule = await source.ssrLoadModule("/apps/desktop/src/film-generation-plan.ts");
    const lineageModule = await source.ssrLoadModule(
      "/apps/desktop/src/film-generation-lineage.ts",
    );
    const sourceModule = await source.ssrLoadModule("/apps/desktop/src/film-generation-sources.ts");
    const intent = json(clean);
    delete intent.shots[0].reviewedVideoPrompt;
    intent.shots[0].picture = `${intent.scenes.find((scene) => scene.id === intent.shots[0].sceneId).where}里雨水反光。`;
    const scope = {
      projectId: intent.id,
      expectedProjectHash: "a".repeat(64),
      mode: "video",
      targets: [{ shotId: intent.shots[0].id, versions: 1 }],
    };
    const plan = planModule.compileCanonicalGenerationPlan(
      exports,
      intent,
      intent,
      scope,
      new Set(),
    );
    const frame = plan.stages.find((stage) => stage.public.kind === "shot-frame");
    assert.ok(frame);
    assert.ok(plan.targets[0].clientFrame);
    const clientFrame = exports.shotStillInput(
      exports.prepareSceneLocations(intent),
      intent.shots[0],
      exports.keyframePrompt(intent.shots[0], exports.prepareSceneLocations(intent)),
    );
    assert.deepEqual(plan.targets[0].clientFrame.references, json(clientFrame.references));
    const films = join(directory, "films"),
      story = join(directory, "story");
    const episode = join(films, "series", "episodes", "project");
    await mkdir(episode, { recursive: true });
    await mkdir(story);
    const image = join(episode, "generated.png");
    await writeFile(image, "actual locally retained automatic image bytes");
    const sources = await sourceModule.generationImageSources({
      filmsRoot: films,
      storyFilmsRoot: story,
      seriesId: "series",
      projectId: "project",
      backendProjectId: "prj_bound",
      storySourceOwner: async () => false,
    });
    const captured = await sources.capture(image);
    const current = json(intent);
    current.shots[0].poster = image;
    const restored = await lineageModule.restoreGenerationIntent(
      exports,
      current,
      [current.shots[0].id],
      sources,
      [
        {
          output_sha256: captured.sha256,
          stage: { kind: "shot-frame", target_id: frame.public.targetId, origin: frame.origin },
        },
      ],
    );
    assert.equal(restored.shots[0].poster, intent.shots[0].poster);
    assert.equal(current.shots[0].poster, image);
    assert.deepEqual(
      json(exports.storyFilmBatches(restored, [restored.shots[0]], false)),
      json(exports.storyFilmBatches(intent, [intent.shots[0]], false)),
    );
    const locationStage = plan.stages.find((stage) => stage.public.kind === "location-reference");
    assert.ok(locationStage);
    const withReferences = exports.prepareSceneLocations(json(current));
    const place = withReferences.locations.find((row) => row.id === locationStage.public.targetId);
    const scene = withReferences.scenes.find((row) => row.id === place.sceneId);
    const locationImage = join(episode, "location.png");
    await writeFile(locationImage, "distinct real retained scene image bytes");
    const locationCapture = await sources.capture(locationImage);
    place.referenceImage = locationImage;
    place.referenceStyleRevision = withReferences.styleRevision ?? 0;
    place.referenceLayout = place.layout ?? "";
    place.referenceSceneSignature = JSON.stringify([
      scene.id,
      scene.title,
      scene.where,
      scene.text,
    ]);
    assert.equal(exports.locationImageCurrent(withReferences, place), true);
    assert.ok(
      exports
        .shotStillInput(
          withReferences,
          withReferences.shots[0],
          exports.keyframePrompt(withReferences.shots[0], withReferences),
        )
        .references.includes(locationImage),
    );
    assert.notDeepEqual(
      json(exports.storyFilmBatches(withReferences, [withReferences.shots[0]], false)),
      json(exports.storyFilmBatches(intent, [intent.shots[0]], false)),
    );
    const projected = await lineageModule.restoreGenerationIntent(
      exports,
      withReferences,
      [withReferences.shots[0].id],
      sources,
      [
        {
          output_sha256: captured.sha256,
          stage: { kind: "shot-frame", target_id: frame.public.targetId, origin: frame.origin },
        },
        {
          output_sha256: locationCapture.sha256,
          stage: {
            kind: "location-reference",
            target_id: locationStage.public.targetId,
            origin: locationStage.origin,
          },
        },
      ],
    );
    assert.equal(projected.shots[0].poster, intent.shots[0].poster);
    assert.deepEqual(
      json(exports.storyFilmBatches(projected, [projected.shots[0]], false)),
      json(exports.storyFilmBatches(intent, [intent.shots[0]], false)),
    );
    const fixedFramePlan = planModule.compileCanonicalGenerationPlan(
      exports,
      current,
      current,
      scope,
      new Set(),
    );
    assert.equal(fixedFramePlan.targets[0].clientFrame, undefined);
    const changed = json(current);
    changed.shots[0].picture = "用户替换了真实画面创作。";
    const notRestored = await lineageModule.restoreGenerationIntent(
      exports,
      changed,
      [changed.shots[0].id],
      sources,
      [
        {
          output_sha256: captured.sha256,
          stage: { kind: "shot-frame", target_id: frame.public.targetId, origin: frame.origin },
        },
      ],
    );
    assert.equal(notRestored.shots[0].poster, image);
    assert.notDeepEqual(
      json(exports.storyFilmBatches(notRestored, [notRestored.shots[0]], false)),
      json(exports.storyFilmBatches(intent, [intent.shots[0]], false)),
    );
    for (const row of receipt.sources) {
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(root, row.source)))
          .digest("hex"),
        row.sha256,
      );
    }
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});
