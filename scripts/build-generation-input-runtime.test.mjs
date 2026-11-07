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
          stage: {
            kind: "shot-frame",
            target_id: frame.public.targetId,
            origin: { ...frame.origin, references: [] },
          },
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
          stage: {
            kind: "shot-frame",
            target_id: frame.public.targetId,
            origin: { ...frame.origin, references: [] },
          },
        },
        {
          output_sha256: locationCapture.sha256,
          stage: {
            kind: "location-reference",
            target_id: locationStage.public.targetId,
            origin: { ...locationStage.origin, references: [] },
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
          stage: {
            kind: "shot-frame",
            target_id: frame.public.targetId,
            origin: { ...frame.origin, references: [] },
          },
        },
      ],
    );
    assert.equal(notRestored.shots[0].poster, image);
    assert.notDeepEqual(
      json(exports.storyFilmBatches(notRestored, [notRestored.shots[0]], false)),
      json(exports.storyFilmBatches(intent, [intent.shots[0]], false)),
    );
    const forecastModule = await source.ssrLoadModule(
      "/apps/desktop/src/film-generation-forecast.ts",
    );
    const beforeForecast = json(intent);
    const forecast = forecastModule.forecastGenerationReferences(exports, plan, intent);
    assert.deepEqual(json(intent), beforeForecast); // No fake media reaches the actual record.
    const forecastFrame = forecast.targets[0].clientFrame;
    assert.ok(forecastFrame);
    assert.ok(forecastFrame.references.some((ref) => forecast.plannedSources.has(ref)));
    const actualCapture = async (ref) => {
      assert.ok(!ref.startsWith("https://aivora-planned.invalid/"));
      return sources.capture(ref);
    };
    const selectedInputs = await forecastModule.forecastReferenceInputs(
      forecast,
      forecastFrame.references,
      actualCapture,
    );
    assert.ok(selectedInputs.some((input) => input.plannedImage));
    const relabelled = json(plan);
    relabelled.targets[0].key = "different-execution-target";
    relabelled.stages.forEach((stage, index) => {
      stage.public.stageId = `different-stage-${index}`;
    });
    const relabelForecast = forecastModule.forecastGenerationReferences(
      exports,
      relabelled,
      intent,
    );
    assert.deepEqual(
      json(
        await forecastModule.forecastReferenceInputs(
          relabelForecast,
          relabelForecast.targets[0].clientFrame.references,
          actualCapture,
        ),
      ),
      json(selectedInputs),
    );
    await assert.rejects(
      () =>
        forecastModule.forecastReferenceInputs(
          forecast,
          ["https://aivora-planned.invalid/not-issued.png"],
          actualCapture,
        ),
      /UNSUPPORTED_SCOPE/,
    );
    const plannedFrameProof = {
      output_sha256: captured.sha256,
      stage: {
        kind: "shot-frame",
        target_id: frame.public.targetId,
        origin: {
          ...frame.origin,
          prompt: forecastFrame.prompt,
          referenceMode: "planned-v1",
          references: selectedInputs,
        },
      },
    };
    const plannedLocationProof = {
      output_sha256: locationCapture.sha256,
      stage: {
        kind: "location-reference",
        target_id: locationStage.public.targetId,
        origin: { ...locationStage.origin, references: [] },
      },
    };
    assert.equal(
      await lineageModule.generationReferencesMatch(selectedInputs, [locationImage], sources, [
        plannedLocationProof,
      ]),
      true,
    );
    assert.equal(
      await lineageModule.generationReferencesMatch(selectedInputs, [locationImage], sources, []),
      false,
    );
    const wrongCreator = json(plannedLocationProof);
    wrongCreator.stage.origin.prompt += "用户变更原始参考创作";
    assert.equal(
      await lineageModule.generationReferencesMatch(selectedInputs, [locationImage], sources, [
        wrongCreator,
      ]),
      false,
    );
    const verifiedStage = await lineageModule.verifyGenerationStageImage(
      exports,
      withReferences,
      frame,
      plannedFrameProof.stage.origin,
      sources,
      [plannedLocationProof],
    );
    assert.deepEqual(json(verifiedStage.references), [locationImage]);
    assert.equal(verifiedStage.prompt, forecastFrame.prompt);
    const editedStageRecord = json(withReferences);
    editedStageRecord.shots[0].picture += "用户在派发前改变画面";
    await assert.rejects(
      () =>
        lineageModule.verifyGenerationStageImage(
          exports,
          editedStageRecord,
          frame,
          plannedFrameProof.stage.origin,
          sources,
          [plannedLocationProof],
        ),
      /SOURCE_UNVERIFIABLE/,
    );
    const plannedRestored = await lineageModule.restoreGenerationIntent(
      exports,
      withReferences,
      [withReferences.shots[0].id],
      sources,
      [plannedFrameProof, plannedLocationProof],
    );
    assert.equal(plannedRestored.shots[0].poster, intent.shots[0].poster);
    assert.deepEqual(
      json(exports.storyFilmBatches(plannedRestored, [plannedRestored.shots[0]], false)),
      json(exports.storyFilmBatches(intent, [intent.shots[0]], false)),
    );
    const withPeople = json(intent);
    withPeople.characters = [
      {
        ...json(film.characters[0]),
        id: "visible-person",
        name: "画中人",
        identity: "蓝色长外套，短黑发。",
        portraits: [],
      },
      {
        ...json(film.characters[0]),
        id: "unused-person",
        name: "不在此镜的人",
        identity: "红色外套，长发。",
        portraits: [],
      },
    ];
    withPeople.shots[0].characters = ["画中人"];
    withPeople.shots[0].picture = "画中人站在原场景里。";
    const pipelineScope = { ...scope, mode: "pipeline" };
    const forecastPeople = (record) => {
      const nextPlan = planModule.compileCanonicalGenerationPlan(
        exports,
        record,
        record,
        { ...pipelineScope, targets: [{ shotId: record.shots[0].id, versions: 1 }] },
        new Set([record.shots[0].id]),
      );
      return forecastModule.forecastGenerationReferences(exports, nextPlan, record);
    };
    const peopleForecast = forecastPeople(withPeople);
    const inputsForFrame = async (value) =>
      json(
        await forecastModule.forecastReferenceInputs(
          value,
          value.targets[0].clientFrame.references,
          actualCapture,
        ),
      );
    const usedPeople = await inputsForFrame(peopleForecast);
    const mappedForecast = await forecastModule.buildGenerationForecastInputs(
      peopleForecast,
      actualCapture,
    );
    assert.equal(mappedForecast.length, 1);
    assert.ok(mappedForecast[0].forecast.sources.length > 0);
    const protocolSource = mappedForecast[0].forecast.sources[0];
    assert.deepEqual(Object.keys(protocolSource).sort(), ["identity", "source"]);
    assert.ok(protocolSource.identity.plannedImage);
    assert.ok(!JSON.stringify(protocolSource.identity).includes("stageId"));
    assert.ok(!JSON.stringify(protocolSource.identity).includes("visible-person"));
    assert.ok(!JSON.stringify(protocolSource.identity).includes("https://aivora-planned.invalid/"));
    assert.ok(JSON.stringify(usedPeople).includes("蓝色长外套"));
    assert.ok(!JSON.stringify(usedPeople).includes("红色外套"));
    // Side/back creators consume the issued front creator; no fabricated front bytes.
    const sideCreator = peopleForecast.stages.find((stage) =>
      stage.creator.prompt.includes("正侧面"),
    );
    assert.ok(sideCreator);
    const sideReferences = await forecastModule.forecastReferenceInputs(
      peopleForecast,
      sideCreator.creator.references,
      actualCapture,
    );
    assert.ok(sideReferences[0].plannedImage.prompt.includes("正面全身"));
    const copiedShot = json(withPeople);
    copiedShot.shots[0].id = "new-local-shot-id-same-creative-request";
    copiedShot.characters[0].id = "new-local-character-id-same-visible-person";
    assert.deepEqual(await inputsForFrame(forecastPeople(copiedShot)), usedPeople);
    const unusedChanged = json(withPeople);
    unusedChanged.characters[1].identity = "用户修改未出镜人物的造型。";
    assert.deepEqual(await inputsForFrame(forecastPeople(unusedChanged)), usedPeople);
    const usedChanged = json(withPeople);
    usedChanged.characters[0].identity = "黄色雨衣，卷发。";
    assert.notDeepEqual(await inputsForFrame(forecastPeople(usedChanged)), usedPeople);
    const byteA = async () => ({ sha256: "a".repeat(64), mime: "image/png" });
    const byteB = async () => ({ sha256: "b".repeat(64), mime: "image/png" });
    assert.notDeepEqual(
      json(await forecastModule.forecastReferenceInputs(forecast, [locationImage], byteA)),
      json(await forecastModule.forecastReferenceInputs(forecast, [locationImage], byteB)),
    );
    const registrationModule = await source.ssrLoadModule(
      "/apps/desktop/src/film-generation-registration.ts",
    );
    await assert.rejects(
      () => registrationModule.buildGenerationRegistration(exports, plan, intent, sources),
      /UNSUPPORTED_SCOPE/,
    ); // Consumed missing automatic references await the full intent compiler.
    const fixed = exports.prepareSceneLocations(json(intent));
    const fixedPlace = fixed.locations.find((row) => row.id === locationStage.public.targetId);
    Object.assign(fixedPlace, exports.locationImageFields(fixed, fixedPlace, locationImage));
    const fixedPlan = planModule.compileCanonicalGenerationPlan(
      exports,
      fixed,
      fixed,
      scope,
      new Set(),
    );
    const registration = await registrationModule.buildGenerationRegistration(
      exports,
      fixedPlan,
      fixed,
      sources,
    );
    assert.equal(registration.targets[0].first_regenerate, false);
    assert.equal(registration.targets[0].versions, 1);
    const registeredFrame = registration.stages.find((stage) => stage.kind === "shot-frame");
    assert.deepEqual(json(registeredFrame.origin.references), [
      { sha256: locationCapture.sha256, mime: "image/png" },
    ]);
    assert.deepEqual(registration.targets[0].sources, [
      { source: locationImage, sha256: locationCapture.sha256 },
    ]);
    assert.equal(
      exports.generationHadTakes({ ...fixed.shots[0], takes: [{ ...oldTake, status: "failed" }] }),
      false,
    );
    assert.equal(exports.generationHadTakes({ ...fixed.shots[0], takes: [oldTake] }), true);
    const freshPool = await sourceModule.generationImageSources({
      filmsRoot: films,
      storyFilmsRoot: story,
      seriesId: "series",
      projectId: "project",
      backendProjectId: "prj_bound",
      storySourceOwner: async () => false,
    });
    await freshPool.capture(image);
    await writeFile(locationImage, "user actually replaced the fixed reference bytes");
    await freshPool.capture(locationImage);
    const changedReference = json(fixed);
    changedReference.shots[0].poster = image;
    const refusedProjection = await lineageModule.restoreGenerationIntent(
      exports,
      changedReference,
      [changedReference.shots[0].id],
      freshPool,
      [
        {
          output_sha256: captured.sha256,
          stage: {
            kind: "shot-frame",
            target_id: registeredFrame.target_id,
            origin: registeredFrame.origin,
          },
        },
      ],
    );
    assert.equal(refusedProjection.shots[0].poster, image);
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
