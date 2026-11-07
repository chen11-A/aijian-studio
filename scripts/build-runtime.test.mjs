import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  renameSync,
  symlinkSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyDesktopRuntime } from "./desktop-runtime-closure.mjs";
import { resourceImports } from "./desktop-runtime-resources.mjs";
import { asarManifestPath } from "./e2e/asar-manifest-path.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modules = [
  "generated",
  "artifact-proposal",
  "invalidation-operation",
  "chatgpt-auth",
  "official-text",
  "official-director",
  "shot-plan",
];

test("real ASAR nested manifest paths work with Windows traversal", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "aivora-asar-path-"));
  try {
    const require = createRequire(join(root, "packaging/windows/build-toolchain/package.json"));
    const asar = require("@electron/asar");
    const filename = "node_modules/@aijian/contracts/artifact-proposal.d.ts";
    const source = join(temporary, "app");
    const file = join(source, ...filename.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    const contents = "export type Synthetic = string;\n";
    writeFileSync(file, contents);
    const archive = join(temporary, "app.asar");
    await asar.createPackage(source, archive);
    assert.equal(asar.extractFile(archive, asarManifestPath(filename)).toString(), contents);
    const libraryPath = require.resolve("@electron/asar/lib/filesystem.js");
    const libraryRequire = createRequire(libraryPath);
    const module = { exports: {} };
    runInNewContext(
      readFileSync(libraryPath, "utf8"),
      {
        module,
        exports: module.exports,
        require: (name) => (name === "path" ? win32 : libraryRequire(name)),
      },
      { filename: libraryPath },
    );
    const makeWindowsFilesystem = () => {
      const filesystem = new module.exports.Filesystem("C:\\synthetic");
      const raw = asar.getRawHeader(archive);
      filesystem.setHeader(JSON.parse(JSON.stringify(raw.header)), raw.headerSize);
      return filesystem;
    };
    assert.throws(() => makeWindowsFilesystem().getFile(filename), /not found in this archive/);
    assert.equal(
      makeWindowsFilesystem().getFile(asarManifestPath(filename, win32)).size,
      Buffer.byteLength(contents),
    );
    for (const unsafe of ["../escape", "/absolute", "a//b", "C:/root", "a\\b"]) {
      assert.throws(() => asarManifestPath(unsafe), /plain relative/);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("builder retains only the explicit contract declaration exceptions", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "aivora-builder-contracts-"));
  try {
    const require = createRequire(join(root, "packaging/windows/build-toolchain/package.json"));
    const { FileMatcher, getNodeModuleFileMatcher } = require("app-builder-lib/out/fileMatcher.js");
    const { NodeModuleCopyHelper } = require("app-builder-lib/out/util/NodeModuleCopyHelper.js");
    const { doMergeConfigs } = require("app-builder-lib/out/util/config/config.js");
    const include = require(join(root, "packaging/windows/include-dev-contract-types.cjs"));
    const contracts = join(temporary, "node_modules/@aijian/contracts");
    mkdirSync(contracts, { recursive: true });
    for (const name of [
      "generated.js",
      ...modules.map((name) => `${name}.d.ts`),
      "private.d.ts",
      "shot-plan-private.d.ts",
      "package.json",
    ]) {
      writeFileSync(join(contracts, name), name === "package.json" ? "{}" : "");
    }
    const config = JSON.parse(
      readFileSync(join(root, "packaging/windows/electron-builder.dev-core.json"), "utf8"),
    );
    const collect = (hook, files = config.files) => {
      const mainMatcher = getNodeModuleFileMatcher(
        temporary,
        join(temporary, "out"),
        (value) => value,
        {},
        {
          config: doMergeConfigs([{ files: JSON.parse(JSON.stringify(files)) }]),
          debugLogger: { isEnabled: false },
        },
      );
      return new NodeModuleCopyHelper(
        new FileMatcher(contracts, join(temporary, "out"), (value) => value, mainMatcher.patterns),
        {
          config: { onNodeModuleFile: hook },
          appInfo: { type: "commonjs" },
          getWorkspaceRoot: async () => temporary,
        },
      ).collectNodeModules(
        { name: "@aijian/contracts", dir: contracts },
        [".d.ts"],
        "node_modules/@aijian/contracts",
      );
    };
    assert.equal(
      (await collect(undefined)).some((path) => path.endsWith("generated.d.ts")),
      false,
    );
    // Both input syntaxes are normalized by the real builder before matching.
    assert.equal(
      (await collect(include, ["**/*"])).some((path) => path.endsWith("generated.d.ts")),
      true,
    );
    const files = await collect(include);
    assert.equal(
      files.some((path) => path.endsWith("generated.d.ts")),
      true,
    );
    assert.equal(
      files.some((path) => path.endsWith("private.d.ts")),
      false,
    );
    for (const name of modules) {
      assert.equal(
        files.some((path) => path.endsWith(`${name}.d.ts`)),
        true,
        `declared contract ${name} must retain its exact declaration file`,
      );
      assert.equal(include(`C:\\app\\node_modules\\@aijian\\contracts\\${name}.d.ts`), true);
    }
    assert.equal(
      include("C:\\app\\node_modules\\@aijian\\contracts\\shot-plan-private.d.ts"),
      false,
    );
    assert.equal(include("C:\\outside\\generated.d.ts"), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("production application has complete isolated exports, hashes and no test artifacts", async (context) => {
  const temporary = mkdtempSync(join(tmpdir(), "aivora-runtime-test-"));
  try {
    const output = join(temporary, "app");
    const script = join(root, "scripts/build-desktop-runtime.mjs");
    const resources = join(temporary, "resources");
    mkdirSync(resources);
    const collection = spawnSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        `
import importlib.util, pathlib, sys
spec=importlib.util.spec_from_file_location("real_collector", sys.argv[2])
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
root=pathlib.Path(sys.argv[1])
module.stage_qc_resources(root/"qc")
module.stage_project_archive_resources(root/"project-archive")
module.stage_audio_library_resources(root/"audio-library")
`,
        resources,
        "packaging/windows/freeze-sidecar.py",
      ],
      { cwd: root, encoding: "utf8", shell: false },
    );
    assert.equal(collection.status, 0, collection.stderr);
    for (const args of [
      ["--out-dir", join(temporary, "missing-flag-app")],
      [
        "--out-dir",
        join(temporary, "missing-root-app"),
        "--resources-root",
        join(temporary, "not-collected"),
      ],
    ]) {
      const rejected = spawnSync(process.execPath, [script, ...args], {
        cwd: root,
        encoding: "utf8",
        shell: false,
      });
      assert.notEqual(rejected.status, 0);
      assert.equal(existsSync(args[1]), false);
    }
    const result = spawnSync(
      process.execPath,
      [script, "--out-dir", output, "--resources-root", resources],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.release_approved, false);
    assert.equal(receipt.bundled_resource_closure.reviewedImportSites, 6);
    assert.equal(receipt.bundled_resource_closure.modules.length, 9);
    assert.equal(receipt.bundled_resource_closure.files.length, 470);
    assert.equal(receipt.bundled_resource_closure.authorization, false);
    await context.test(
      "known closure rejects self-consistent replacement code and its rewritten index",
      () => {
        const module = join(resources, "audio-library/audio-picker.mjs"),
          index = join(resources, "audio-library/resource-index.json");
        const original = readFileSync(module),
          originalIndex = readFileSync(index);
        try {
          const changed = Buffer.concat([
            original,
            Buffer.from('\nimport "caller-selected-package";\n'),
          ]);
          writeFileSync(module, changed);
          const rewritten = JSON.parse(originalIndex);
          rewritten.pickerSha256 = createHash("sha256").update(changed).digest("hex");
          writeFileSync(index, JSON.stringify(rewritten));
          assert.equal(
            JSON.parse(readFileSync(index)).pickerSha256,
            createHash("sha256").update(readFileSync(module)).digest("hex"),
          );
          assert.throws(() => verifyDesktopRuntime(output, resources), /closure needs review/);
        } finally {
          writeFileSync(module, original);
          writeFileSync(index, originalIndex);
        }
      },
    );
    await context.test(
      "known loader filename cannot authorize a changed entry or a new dynamic import",
      () => {
        const loader = join(output, "dist/film-export-qc-runtime.js"),
          original = readFileSync(loader);
        try {
          writeFileSync(
            loader,
            original.toString().replace('"index.mjs"', '"unreviewed-entry.mjs"'),
          );
          assert.throws(() => verifyDesktopRuntime(output, resources), /closure needs review/);
        } finally {
          writeFileSync(loader, original);
        }
        const main = join(output, "dist/main.js"),
          mainBytes = readFileSync(main);
        try {
          writeFileSync(
            main,
            Buffer.concat([
              mainBytes,
              Buffer.from("\n(async()=>import(globalThis.CALLER_SELECTED_MODULE))();\n"),
            ]),
          );
          assert.throws(() => verifyDesktopRuntime(output, resources), /closure needs review/);
        } finally {
          writeFileSync(main, mainBytes);
        }
      },
    );
    await context.test(
      "missing, unlisted and junction-escaped actual resources remain rejected",
      () => {
        const module = join(resources, "qc/index.mjs"),
          original = readFileSync(module);
        try {
          rmSync(module);
          assert.throws(() => verifyDesktopRuntime(output, resources));
        } finally {
          writeFileSync(module, original);
        }
        for (const name of ["unreviewed.mjs", "private-cache.json"]) {
          const extra = join(resources, "qc", name);
          try {
            writeFileSync(extra, "SYNTHETIC_UNLISTED_INPUT");
            assert.throws(() => verifyDesktopRuntime(output, resources), /closure needs review/);
          } finally {
            rmSync(extra, { force: true });
          }
        }
        const qc = join(resources, "qc"),
          outside = join(temporary, "outside-qc");
        renameSync(qc, outside);
        try {
          symlinkSync(outside, qc, "junction");
          assert.throws(() => verifyDesktopRuntime(output, resources), /closure needs review/);
          assert.deepEqual(readFileSync(join(outside, "index.mjs")), original);
        } finally {
          rmSync(qc, { recursive: true, force: true });
          renameSync(outside, qc);
        }
      },
    );
    await context.test(
      "resource dependency parser rejects arbitrary bare, escaped and nonliteral imports",
      () => {
        for (const text of [
          'import "unreviewed-package";',
          'export * from "../outside.mjs";',
          "import(globalThis.USER_PATH);",
          "require(process.env.MODULE);",
          'import "https://example.invalid/module.mjs";',
        ])
          assert.throws(() => resourceImports(text), /closure needs review/);
        assert.deepEqual(resourceImports('import "node:fs";import "./media.mjs";'), [
          "node:fs",
          "./media.mjs",
        ]);
      },
    );
    await context.test(
      "both existing Linux collectors produce a real compatible portable closure",
      () => {
        for (const collector of [
          "scripts/package-native-linux-checkpoint.py",
          "packaging/linux/package-desktop.py",
        ]) {
          const portable = join(
              temporary,
              collector.includes("checkpoint") ? "checkpoint" : "linux",
            ),
            app = join(portable, "apps/desktop");
          mkdirSync(dirname(app), { recursive: true });
          cpSync(output, app, { recursive: true });
          const code = `import importlib.util,pathlib,sys
spec=importlib.util.spec_from_file_location("actual_collector",sys.argv[2])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=pathlib.Path(sys.argv[1])
module.stage_qc_resources(root/"qc")
module.stage_project_archive_resources(root/"project-archive")
module.stage_audio_library_resources(root/"audio-library")
`;
          const collected = spawnSync(
            "uv",
            ["run", "--frozen", "python", "-c", code, portable, collector],
            { cwd: root, encoding: "utf8", shell: false },
          );
          assert.equal(collected.status, 0, collected.stderr);
          const checked = verifyDesktopRuntime(app, portable);
          assert.equal(checked.bundled_resource_closure.modules.length, 9);
          assert.deepEqual(
            checked.bundled_resource_closure.files,
            receipt.bundled_resource_closure.files,
          );
        }
      },
    );

    assert.equal(receipt.windows_execution, "NOT_RUN");
    assert.ok(receipt.reachable_js_files > 2);
    for (const file of receipt.files) {
      assert.equal(file.destination, `app/${file.path}`);
      assert.equal(
        file.sha256,
        createHash("sha256")
          .update(readFileSync(join(output, file.path)))
          .digest("hex"),
      );
      assert.doesNotMatch(file.path, /\.(test|spec)\.js$|test-fixture\.js$/);
    }
    const contracts = join(output, "node_modules/@aijian/contracts");
    const source = JSON.parse(readFileSync(join(root, "packages/contracts/package.json"), "utf8"));
    const exportedModules = Object.keys(source.exports).map((key) =>
      key === "." ? "generated" : key.slice(2),
    );
    const builtFiles = readdirSync(contracts).sort();
    for (const name of exportedModules) {
      assert.equal(builtFiles.includes(`${name}.js`), true, name);
      assert.equal(builtFiles.includes(`${name}.d.ts`), true, name);
    }
    assert.equal(builtFiles.includes("closed-json-schema.js"), true);
    assert.equal(builtFiles.includes("assistant-chat.js"), true);
    for (const name of builtFiles) {
      if (name !== "package.json") assert.match(name, /^[a-z0-9][a-z0-9-]*\.(?:js|d\.ts)$/);
    }
    const built = JSON.parse(readFileSync(join(contracts, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(built.exports).sort(), Object.keys(source.exports).sort());
    // Real CJS require and ESM import using only the new application package.
    const probe = join(output, "probe.mjs");
    writeFileSync(
      probe,
      `import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      for (const key of ${JSON.stringify(Object.keys(built.exports))}) {
        const name = "@aijian/contracts" + (key === "." ? "" : key.slice(1));
        require(name); await import(name);
      }`,
    );
    const smoke = spawnSync(process.execPath, [probe], { cwd: temporary, encoding: "utf8" });
    assert.equal(smoke.status, 0, smoke.stderr);
    const resourceProbe = join(output, "resource-probe.cjs");
    writeFileSync(
      resourceProbe,
      `const assert=require('node:assert/strict');const root=${JSON.stringify(resources)};
      (async()=>{const qc=require('./dist/film-export-qc-runtime.js');assert.equal(typeof await qc.loadQcEngine(root+'/qc'),'function');assert.equal(typeof await qc.loadQcRunner(root+'/qc'),'function');
      assert.equal(typeof (await require('./dist/film-audio-normalize.js').loadAudioNormalizer(root+'/qc')).audioNormalizationFilter,'function');
      assert.equal(typeof (await require('./dist/film-project-archive-runtime.js').loadProjectArchiveEngine(root+'/project-archive')).archiveProject,'function');
      const audio=require('./dist/film-audio-library-runtime.js');assert.equal((await audio.loadTrustedAudioLibrary(root+'/audio-library')).assets.length,206);
      assert.equal(typeof (await audio.loadTrustedAudioPicker(root+'/audio-library')).pickAudio,'function');
      console.log('PINNED_RESOURCE_IMPORTS_PASS');})().catch(()=>process.exitCode=1);`,
    );
    const loaded = spawnSync(process.execPath, [resourceProbe], {
      cwd: temporary,
      encoding: "utf8",
      shell: false,
    });
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.match(loaded.stdout, /PINNED_RESOURCE_IMPORTS_PASS/);

    const again = spawnSync(
      process.execPath,
      [script, "--out-dir", output, "--resources-root", resources],
      { encoding: "utf8" },
    );
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /output must not exist/);
    assert.equal(readFileSync(probe, "utf8").includes("await import(name)"), true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("contracts builder rejects undeclared output and unsafe source exports", () => {
  const temporary = mkdtempSync(join(tmpdir(), "aivora-contract-guard-"));
  try {
    for (const path of ["scripts", "packages/contracts", "node_modules/typescript/bin"]) {
      mkdirSync(join(temporary, path), { recursive: true });
    }
    const script = join(temporary, "scripts/build-contracts-runtime.mjs");
    copyFileSync(join(root, "scripts/build-contracts-runtime.mjs"), script);
    const contractSource = join(temporary, "packages/contracts/src");
    mkdirSync(contractSource, { recursive: true });
    for (const name of readdirSync(join(root, "packages/contracts/src"))) {
      if (name.endsWith(".js") || name.endsWith(".d.ts")) {
        copyFileSync(join(root, "packages/contracts/src", name), join(contractSource, name));
      }
    }
    const sourcePath = join(temporary, "packages/contracts/package.json");
    const source = JSON.parse(readFileSync(join(root, "packages/contracts/package.json"), "utf8"));
    writeFileSync(sourcePath, JSON.stringify(source));
    // A bounded fake compiler isolates packaging guards from TypeScript behavior.
    writeFileSync(
      join(temporary, "node_modules/typescript/bin/tsc"),
      `
      const {writeFileSync} = require("node:fs");
      const {join} = require("node:path");
      const output = process.argv[process.argv.indexOf("--outDir") + 1];
      const source = require(${JSON.stringify(join(root, "packages/contracts/package.json"))});
      const names = Object.entries(source.exports)
        .filter(([, value]) => String(value.default).endsWith(".ts"))
        .map(([, value]) => String(value.default).match(/\\/([A-Za-z0-9-]+)\\.ts$/)[1]);
      for (const name of names) {
        for (const ext of ["js", "d.ts"]) writeFileSync(join(output, name+"."+ext), "");
      }
      writeFileSync(join(output, "unexpected.js"), "");
    `,
    );
    const unexpected = spawnSync(
      process.execPath,
      [script, "--out-dir", join(temporary, "extra")],
      { encoding: "utf8" },
    );
    assert.notEqual(unexpected.status, 0);
    assert.match(unexpected.stderr, /source-export allowlist/);
    source.exports["./chatgpt-auth"].default = "../../escape.ts";
    source.exports["./chatgpt-auth"].types = "../../escape.ts";
    writeFileSync(sourcePath, JSON.stringify(source));
    const unsafe = spawnSync(process.execPath, [script, "--out-dir", join(temporary, "unsafe")], {
      encoding: "utf8",
    });
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /Unsupported contracts source export/);
    assert.equal(existsSync(join(temporary, "unsafe")), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
