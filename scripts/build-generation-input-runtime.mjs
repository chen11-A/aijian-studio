import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, realpath, readdir, mkdir, writeFile, rename, lstat, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exportsExpected = [
  "generationVideoBody",
  "keyframePrompt",
  "locationGenerationPrompt",
  "locationImageCurrent",
  "portraitPrompts",
  "prepareSceneLocations",
  "sceneLocation",
  "sceneLocationTargets",
  "shotLocation",
  "shotReference",
  "shotStillInput",
  "storyFilmBatches",
  "withIdentityLocks",
  "withStyleBible",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function sourceInputs(root) {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error("Generation producer source contains a link");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.(?:ts|js)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name))
        files.push(path);
    }
  };
  for (const folder of [
    "apps/studio-web/src/aivora/film",
    "apps/studio-web/src/aivora/pro/actions",
    "packages/contracts/src",
    "packages/aivora-modules/generation-input",
  ])
    await visit(join(root, folder));
  files.push(
    join(root, "apps/studio-web/src/aivora/pro/capabilities.ts"),
    join(root, "pnpm-lock.yaml"),
    fileURLToPath(import.meta.url),
  );
  return Object.fromEntries(
    await Promise.all(
      files
        .sort()
        .map(async (path) => [
          relative(root, path).split(sep).join("/"),
          sha(await readFile(path)),
        ]),
    ),
  );
}

/** Bundle the original pure producer, not a second prompt implementation. Runtime has
 * no source fallback, imports, filesystem, network or renderer-global capability. */
export async function buildGenerationInputRuntime(output, root = sourceRoot) {
  root = await realpath(root);
  if (!isAbsolute(output)) throw Error("Generation producer output must be absolute");
  const inputsBefore = await sourceInputs(root);
  const require = createRequire(join(root, "apps/studio-web/package.json"));
  const { build } = await import(pathToFileURL(require.resolve("vite")).href);
  const typescript = require("typescript");
  const built = await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: join(root, "packages/aivora-modules/generation-input/index.ts"),
        formats: ["cjs"],
        fileName: () => "film-generation-producer.js",
      },
      rolldownOptions: { platform: "node" },
    },
  });
  const chunks = (Array.isArray(built) ? built : [built]).flatMap((result) => result.output);
  if (
    chunks.length !== 1 ||
    chunks[0].type !== "chunk" ||
    chunks[0].imports.length ||
    chunks[0].dynamicImports.length ||
    JSON.stringify([...chunks[0].exports].sort()) !== JSON.stringify(exportsExpected)
  )
    throw Error("Generation producer closure is unsupported");
  const chunk = chunks[0];
  // These checks inspect the emitted closure, including retained initializers, not a
  // filename allowlist. Any new runtime import or ambient execution fails closed.
  const forbidden = new Set([
    "require",
    "eval",
    "Function",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "process",
    "window",
    "document",
    "globalThis",
    "self",
    "Deno",
    "Bun",
  ]);
  const ast = typescript.createSourceFile(
    "producer.js",
    chunk.code,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS,
  );
  const visit = (node) => {
    if (
      node.kind === typescript.SyntaxKind.ImportKeyword ||
      typescript.isImportDeclaration(node) ||
      (typescript.isIdentifier(node) && forbidden.has(node.text))
    )
      throw Error("Generation producer has an ambient runtime dependency");
    typescript.forEachChild(node, visit);
  };
  visit(ast);
  const sources = [];
  for (const modulePath of Object.keys(chunk.modules)) {
    const path = await realpath(modulePath);
    const local = relative(root, path).split(sep).join("/");
    if (
      local.startsWith("../") ||
      ![
        "apps/studio-web/src/aivora/film/",
        "apps/studio-web/src/aivora/pro/actions/",
        "apps/studio-web/src/aivora/pro/capabilities.ts",
        "packages/contracts/src/",
        "packages/aivora-modules/generation-input/",
      ].some((prefix) => local.startsWith(prefix))
    )
      throw Error("Generation producer source is outside the reviewed pure boundary");
    const hash = sha(await readFile(path));
    if (inputsBefore[local] !== hash)
      throw Error("Generation producer source changed during build");
    sources.push({ source: local, sha256: hash });
  }
  sources.sort((a, b) => a.source.localeCompare(b.source, "en"));
  const receipt = {
    schemaVersion: 1,
    entry: "packages/aivora-modules/generation-input/index.ts",
    exports: exportsExpected,
    sources,
    lockSha256: sha(await readFile(join(root, "pnpm-lock.yaml"))),
    builderSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    buildInputsSha256: sha(JSON.stringify(inputsBefore)),
    outputSha256: sha(chunk.code),
    runtimeImports: [],
    authorization: false,
  };
  if (JSON.stringify(await sourceInputs(root)) !== JSON.stringify(inputsBefore))
    throw Error("Generation producer source changed during build");
  await mkdir(output, { recursive: true });
  // Rebuilding dist replaces only these two owned artifacts; no caller-directed
  // module names, symlink destinations or source imports exist at runtime.
  for (const [name, bytes] of [
    ["film-generation-producer.js", chunk.code],
    ["film-generation-producer.sources.json", `${JSON.stringify(receipt, null, 2)}\n`],
  ]) {
    const path = join(output, name);
    const existing = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink()))
      throw Error("Generation producer destination is not an owned regular file");
    const pending = `${path}.building-${process.pid}`;
    try {
      await writeFile(pending, bytes, { flag: "wx", mode: 0o600 });
      await rename(pending, path);
    } catch (error) {
      await rm(pending, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--out-dir" || !isAbsolute(args[1])))
    throw Error("Usage: build-generation-input-runtime.mjs --out-dir <absolute directory>");
  await buildGenerationInputRuntime(
    args.length ? resolve(args[1]) : join(sourceRoot, "apps/desktop/dist"),
  );
}
