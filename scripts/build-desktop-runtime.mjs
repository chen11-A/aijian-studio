// Build an isolated production application tree. This never runs Electron,
// stages media, approves release inputs, downloads tools or builds an installer.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { verifyDesktopRuntime } from "./desktop-runtime-closure.mjs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (
  args.length !== 4 ||
  args[0] !== "--out-dir" ||
  !isAbsolute(args[1]) ||
  args[2] !== "--resources-root" ||
  !isAbsolute(args[3])
) {
  throw new Error(
    "Usage: node scripts/build-desktop-runtime.mjs --out-dir <absolute new directory> --resources-root <actual collector directory>",
  );
}
const output = resolve(args[1]);
const resourcesRoot = resolve(args[3]);
if (
  !existsSync(resourcesRoot) ||
  !lstatSync(resourcesRoot).isDirectory() ||
  lstatSync(resourcesRoot).isSymbolicLink()
)
  throw new Error("Actual collected runtime resources are required");
if (existsSync(output)) throw new Error("Desktop runtime output must not exist");
for (let parent = dirname(output); ; parent = dirname(parent)) {
  if (
    existsSync(parent) &&
    (lstatSync(parent).isSymbolicLink() ||
      realpathSync(parent).toLowerCase() !== parent.toLowerCase())
  ) {
    throw new Error("Desktop runtime output cannot pass through a link or junction");
  }
  if (dirname(parent) === parent) break;
}
const compiler = join(root, "node_modules/typescript/bin/tsc");
if (!existsSync(compiler)) throw new Error("Pinned workspace TypeScript is unavailable");

function command(...arguments_) {
  const result = spawnSync(process.execPath, arguments_, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Runtime build failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
}

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Runtime contains a link: ${path}`);
      if (entry.isDirectory()) return filesIn(path);
      if (!entry.isFile()) throw new Error(`Runtime contains a non-file: ${path}`);
      return [path];
    })
    .sort();
}

function sourceFingerprint() {
  const inputs = [
    ...filesIn(join(root, "apps/desktop/src")).filter((path) => path.endsWith(".ts")),
    ...filesIn(join(root, "packages/contracts/src")).filter(
      (path) => path.endsWith(".ts") || path.endsWith(".js") || path.endsWith(".d.ts"),
    ),
    ...[
      "apps/desktop/tsconfig.json",
      "packages/contracts/tsconfig.json",
      "packages/contracts/tsconfig.runtime.json",
      "packages/contracts/package.json",
      "packaging/windows/app-runtime.package.json",
      "pnpm-lock.yaml",
      "scripts/build-contracts-runtime.mjs",
      "scripts/build-desktop-runtime.mjs",
      "scripts/desktop-runtime-closure.mjs",
      "scripts/desktop-runtime-resources.mjs",
      "config/desktop-runtime-resources.json",
    ].map((path) => join(root, path)),
  ].sort();
  return Object.fromEntries(
    inputs.map((path) => [
      relative(root, path).split(sep).join("/"),
      createHash("sha256").update(readFileSync(path)).digest("hex"),
    ]),
  );
}
const sources = sourceFingerprint();
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (head.status !== 0) throw new Error("Cannot bind the production build to candidate HEAD");
const candidateHead = head.stdout.trim();
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "aivora-production-ts-"));
try {
  const config = join(temporary, "tsconfig.json");
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(root, "apps/desktop/tsconfig.json"),
      compilerOptions: {
        outDir: join(output, "dist"),
        typeRoots: [join(root, "apps/desktop/node_modules/@types")],
        noEmitOnError: true,
      },
      include: [],
      files: [join(root, "apps/desktop/src/main.ts"), join(root, "apps/desktop/src/preload.ts")],
    }),
  );
  command(compiler, "-p", config);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
command(
  join(root, "scripts/build-contracts-runtime.mjs"),
  "--out-dir",
  join(output, "node_modules/@aijian/contracts"),
);
copyFileSync(
  join(root, "packaging/windows/app-runtime.package.json"),
  join(output, "package.json"),
);

const paths = filesIn(output);
for (const path of paths) {
  if (/\.(test|spec)\.(js|cjs|mjs)$|(?:^|[-/\\])test-fixture\.(js|cjs|mjs)$/i.test(path)) {
    throw new Error(`Production runtime contains a test artifact: ${path}`);
  }
}
const app = JSON.parse(readFileSync(join(output, "package.json"), "utf8"));
const contracts = JSON.parse(
  readFileSync(join(output, "node_modules/@aijian/contracts/package.json"), "utf8"),
);
if (app.dependencies[contracts.name] !== contracts.version) {
  throw new Error("Desktop and contracts runtime versions differ");
}

// Static dependencies retain the original containment rules; nonliteral imports
// must additionally bind the reviewed code and actual collector resource closure.
const closure = verifyDesktopRuntime(output, resourcesRoot);

const files = paths.map((path) => ({
  path: relative(output, path).split(sep).join("/"),
  destination: `app/${relative(output, path).split(sep).join("/")}`,
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
}));
if (JSON.stringify(sourceFingerprint()) !== JSON.stringify(sources)) {
  throw new Error("Source changed during build; retain this output for diagnosis, do not stage it");
}
const currentHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (currentHead.status !== 0 || currentHead.stdout.trim() !== candidateHead) {
  throw new Error("Candidate HEAD changed during build; do not stage this output");
}
process.stdout.write(
  `${JSON.stringify(
    {
      schema_version: 1,
      result: "PRODUCTION_APP_TREE_ONLY",
      candidate_head: candidateHead,
      source_files: sources,
      runtime_resolution: "STATIC_CJS_AND_REVIEWED_RESOURCE_CLOSURE_PASS",
      files,
      ...closure,
      electron_execution: "NOT_RUN",
      windows_execution: "NOT_RUN",
      installer: "NOT_BUILT",
      release_approved: false,
    },
    null,
    2,
  )}\n`,
);
