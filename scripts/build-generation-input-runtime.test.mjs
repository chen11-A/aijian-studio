import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    runInNewContext(javascript, { exports });
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
