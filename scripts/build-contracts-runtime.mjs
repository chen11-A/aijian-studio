import { spawnSync } from "node:child_process";
import process from "node:process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out-dir" || !isAbsolute(args[1])) {
  throw new Error(
    "Usage: node scripts/build-contracts-runtime.mjs --out-dir <absolute empty directory>",
  );
}
const output = resolve(args[1]);
if (existsSync(output)) {
  throw new Error("Contracts runtime output must not exist; choose a fresh directory");
}
const compiler = join(root, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(compiler)) {
  throw new Error("Pinned workspace TypeScript is unavailable");
}
const config = join(root, "packages", "contracts", "tsconfig.runtime.json");
const sourcePackage = JSON.parse(
  readFileSync(join(root, "packages", "contracts", "package.json"), "utf8"),
);
// The public source exports are the allowlist. Do not silently discard a newly
// added contract, or ship unrelated compiled files just because tsc emitted them.
const exports = Object.entries(sourcePackage.exports).map(([key, value]) => {
  const match = /^\.\/src\/([a-zA-Z0-9][a-zA-Z0-9-]*)\.ts$/.exec(value.default);
  if (!match || value.types !== value.default || (key !== "." && key !== `./${match[1]}`)) {
    throw new Error(`Unsupported contracts source export: ${key}`);
  }
  return [key, match[1]];
});
const modules = exports.map(([, moduleName]) => moduleName);
if (!modules.length || new Set(modules).size !== modules.length) {
  throw new Error("Contracts source exports must name distinct modules");
}
mkdirSync(output, { recursive: true });
const compile = spawnSync(
  process.execPath,
  [compiler, "-p", config, "--outDir", output, "--noEmitOnError"],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  },
);
if (compile.error) throw compile.error;
if (compile.status !== 0) {
  throw new Error(`Contracts runtime compilation failed (${compile.status ?? "no status"})`);
}

for (const moduleName of modules) {
  for (const extension of ["js", "d.ts"]) {
    if (!existsSync(join(output, `${moduleName}.${extension}`))) {
      throw new Error(`Contracts runtime output is missing ${moduleName}.${extension}`);
    }
  }
}
const runtimePackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  type: "commonjs",
  exports: Object.fromEntries(
    exports.map(([key, moduleName]) => [
      key,
      {
        types: `./${moduleName}.d.ts`,
        require: `./${moduleName}.js`,
        import: `./${moduleName}.js`,
        default: `./${moduleName}.js`,
      },
    ]),
  ),
};
writeFileSync(join(output, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
const expectedFiles = [
  "package.json",
  ...modules.flatMap((name) => [`${name}.js`, `${name}.d.ts`]),
].sort();
const actualFiles = readdirSync(output).sort();
if (
  actualFiles.length !== expectedFiles.length ||
  actualFiles.some((name, index) => name !== expectedFiles[index])
) {
  throw new Error("Contracts runtime output does not match the source-export allowlist");
}
const files = actualFiles.map((name) => {
  const bytes = readFileSync(join(output, name));
  return { path: name, sha256: createHash("sha256").update(bytes).digest("hex") };
});
process.stdout.write(
  `${JSON.stringify(
    {
      destination: "app/node_modules/@aijian/contracts",
      files,
    },
    null,
    2,
  )}\n`,
);
