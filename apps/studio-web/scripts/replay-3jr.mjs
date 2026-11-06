/* global process, console */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createServer } from "vite";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(app, "../../packages/aivora-prompts/fixtures/test-novel-2000.txt");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let server;
try {
  const [captureArg, outputArg, ...extra] = process.argv.slice(2);
  if (!captureArg || !outputArg || extra.length) throw new Error("REPLAY_USAGE");
  const capturePath = resolve(captureArg);
  const outputPath = resolve(outputArg);
  if (outputPath === capturePath || outputPath === sourcePath)
    throw new Error("REPLAY_OUTPUT_CONFLICT");
  const source = await readFile(sourcePath);
  const capture = await readFile(capturePath);
  let manifest;
  try {
    manifest = JSON.parse(capture.toString("utf8"));
  } catch {
    throw new Error("REPLAY_MANIFEST_INVALID_JSON");
  }
  server = await createServer({
    root: app,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, watch: null },
    appType: "custom",
  });
  const { replay3jr } = await server.ssrLoadModule("/src/aivora/film/replay3jr.ts");
  const result = replay3jr(source.toString("utf8"), manifest, sha256(source));
  const report = { ...result, captureSha256: sha256(capture), sourcePath, capturePath };
  // Refuse to overwrite an old report or any input; reruns require a fresh output path.
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(
    JSON.stringify({
      outputPath,
      captureDeclaration: result.captureDeclaration,
      checksPassed: result.checksPassed,
      scenes: result.scenes.map(({ sceneNo, rawShotCount, shotCount, actions }) => ({
        sceneNo,
        rawShotCount,
        shotCount,
        actions,
      })),
    }),
  );
  if (!result.checksPassed) process.exitCode = 1;
} catch (error) {
  const code =
    error instanceof Error && /^REPLAY_[A-Z_]+$/u.test(error.message)
      ? error.message
      : "REPLAY_IO_OR_LOAD_FAILED";
  console.error(code);
  process.exitCode = 2;
} finally {
  await server?.close();
}
