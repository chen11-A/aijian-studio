import assert from "node:assert/strict";
import process from "node:process";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modules = [
  "generated",
  "artifact-proposal",
  "invalidation-operation",
  "chatgpt-auth",
  "official-text",
];

test("builder retains only the explicit contract declaration exceptions", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "aivora-builder-contracts-"));
  try {
    const require = createRequire(join(root, "packaging/windows/build-toolchain/package.json"));
    const { FileMatcher, getNodeModuleFileMatcher } = require("app-builder-lib/out/fileMatcher.js");
    const { NodeModuleCopyHelper } = require("app-builder-lib/out/util/NodeModuleCopyHelper.js");
    const include = require(join(root, "packaging/windows/include-dev-contract-types.cjs"));
    const contracts = join(temporary, "node_modules/@aijian/contracts");
    mkdirSync(contracts, { recursive: true });
    for (const name of ["generated.js", "generated.d.ts", "private.d.ts", "package.json"]) {
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
          config: { files },
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
    // Regression: a bare inclusive files string leaves the real module matcher
    // empty, so this builder ignores the hook despite forceIncluded=true.
    assert.equal(
      (await collect(include, ["**/*"])).some((path) => path.endsWith("generated.d.ts")),
      false,
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
    assert.equal(include("C:\\outside\\generated.d.ts"), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("production application has complete isolated exports, hashes and no test artifacts", () => {
  const temporary = mkdtempSync(join(tmpdir(), "aivora-runtime-test-"));
  try {
    const output = join(temporary, "app");
    const script = join(root, "scripts/build-desktop-runtime.mjs");
    const result = spawnSync(process.execPath, [script, "--out-dir", output], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.release_approved, false);
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
    assert.deepEqual(
      readdirSync(contracts).sort(),
      ["package.json", ...modules.flatMap((name) => [`${name}.js`, `${name}.d.ts`])].sort(),
    );
    const source = JSON.parse(readFileSync(join(root, "packages/contracts/package.json"), "utf8"));
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
    const again = spawnSync(process.execPath, [script, "--out-dir", output], { encoding: "utf8" });
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
      for (const name of ${JSON.stringify(modules)}) {
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
