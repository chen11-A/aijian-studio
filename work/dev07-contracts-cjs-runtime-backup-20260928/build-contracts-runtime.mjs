import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out-dir" || !isAbsolute(args[1])) {
  throw new Error("Usage: node scripts/build-contracts-runtime.mjs --out-dir <absolute empty directory>");
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
mkdirSync(output, { recursive: true });
const compile = spawnSync(process.execPath, [compiler, "-p", config, "--outDir", output], {
  cwd: root,
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});
if (compile.error) throw compile.error;
if (compile.status !== 0) {
  throw new Error(`Contracts runtime compilation failed (${compile.status ?? "no status"})`);
}

const modules = ["generated", "artifact-proposal", "invalidation-operation"];
for (const moduleName of modules) {
  for (const extension of ["js", "d.ts"]) {
    if (!existsSync(join(output, `${moduleName}.${extension}`))) {
      throw new Error(`Contracts runtime output is missing ${moduleName}.${extension}`);
    }
  }
}
const sourcePackage = JSON.parse(readFileSync(
  join(root, "packages", "contracts", "package.json"), "utf8",
));
const runtimePackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  type: "module",
  exports: {
    ".": { types: "./generated.d.ts", default: "./generated.js" },
    "./artifact-proposal": {
      types: "./artifact-proposal.d.ts", default: "./artifact-proposal.js",
    },
    "./invalidation-operation": {
      types: "./invalidation-operation.d.ts", default: "./invalidation-operation.js",
    },
  },
};
writeFileSync(join(output, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
const files = readdirSync(output).sort().map((name) => {
  const bytes = readFileSync(join(output, name));
  return { path: name, sha256: createHash("sha256").update(bytes).digest("hex") };
});
process.stdout.write(`${JSON.stringify({
  destination: "app/node_modules/@aijian/contracts",
  files,
}, null, 2)}\n`);
