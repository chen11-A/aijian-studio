import { spawnSync } from "node:child_process";
import process from "node:process";
import { createHash } from "node:crypto";
import {
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
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
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
const sourcePackage = JSON.parse(
  readFileSync(join(root, "packages", "contracts", "package.json"), "utf8"),
);
// The public source exports are the allowlist. Do not silently discard a newly
// added contract, or ship unrelated compiled files just because tsc emitted them.
// TypeScript sources are compiled. Hand-written ESM modules are bundled to one
// CommonJS file per public export, including same-directory helpers that are
// not themselves exports.
const contractSource = join(root, "packages", "contracts", "src");
const exports = Object.entries(sourcePackage.exports).map(([key, value]) =>
  classifyContractExport(key, value),
);
const modules = exports.map((entry) => entry.name);
const javascriptModules = new Map(
  exports
    .filter((entry) => entry.kind === "javascript")
    .map((entry) => [entry.name, bundleContractModule(contractSource, entry.name)]),
);
if (!modules.length || new Set(modules).size !== modules.length) {
  throw new Error("Contracts source exports must name distinct modules");
}
mkdirSync(output, { recursive: true });
const compile = compileContractEntries(compiler, root, output, exports);
if (compile.error) throw compile.error;
if (compile.status !== 0) {
  throw new Error(`Contracts runtime compilation failed (${compile.status ?? "no status"})`);
}

for (const [moduleName, bundled] of javascriptModules) {
  writeFileSync(join(output, `${moduleName}.js`), bundled.javascript, {
    encoding: "utf8",
    flag: "wx",
  });
  writeFileSync(join(output, `${moduleName}.d.ts`), bundled.declaration, {
    encoding: "utf8",
    flag: "wx",
  });
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
    exports.map((entry) => [
      entry.key,
      {
        types: `./${entry.name}.d.ts`,
        require: `./${entry.name}.js`,
        import: `./${entry.name}.js`,
        default: `./${entry.name}.js`,
      },
    ]),
  ),
};
writeFileSync(join(output, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
const allowedModules = contractClosure(output, modules);
const expectedFiles = [
  "package.json",
  ...[...allowedModules].flatMap((name) => [`${name}.js`, `${name}.d.ts`]),
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

function compileContractEntries(compiler, repoRoot, output, contractExports) {
  const temporary = mkdtempSync(join(tmpdir(), "aivora-contracts-tsc-"));
  try {
    const config = join(temporary, "tsconfig.json");
    const files = contractExports
      .filter((entry) => entry.kind === "typescript")
      .map((entry) => join(repoRoot, "packages", "contracts", "src", `${entry.name}.ts`));
    writeFileSync(
      config,
      JSON.stringify({
        extends: join(repoRoot, "packages", "contracts", "tsconfig.runtime.json"),
        include: [],
        files,
      }),
    );
    return spawnSync(
      process.execPath,
      [compiler, "-p", config, "--outDir", output, "--noEmitOnError"],
      {
        cwd: repoRoot,
        stdio: "inherit",
        shell: false,
        windowsHide: true,
      },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function contractClosure(output, roots) {
  const allowed = new Set();
  const pending = [...roots];
  while (pending.length) {
    const name = pending.pop();
    if (allowed.has(name)) continue;
    if (!MODULE_NAME.test(name)) throw new Error(`Unsupported contract module name: ${name}`);
    for (const extension of ["js", "d.ts"]) {
      if (!existsSync(join(output, `${name}.${extension}`))) {
        throw new Error(`Contracts runtime output is missing ${name}.${extension}`);
      }
    }
    allowed.add(name);
    const javascript = readFileSync(join(output, `${name}.js`), "utf8");
    const declaration = readFileSync(join(output, `${name}.d.ts`), "utf8");
    pending.push(
      ...localContractSpecifiers(javascript, /require\(["'](\.\/[^"']+)["']\)/g),
      ...localContractSpecifiers(declaration, /from\s+["'](\.\/[^"']+)["']/g),
    );
  }
  return allowed;
}

function localContractSpecifiers(source, pattern) {
  const names = [];
  for (const match of source.matchAll(pattern)) {
    const parsed = /^\.\/([A-Za-z0-9][A-Za-z0-9-]*)(?:\.(?:js|ts))?$/.exec(match[1]);
    if (!parsed) throw new Error(`Contracts runtime import escaped the package: ${match[1]}`);
    names.push(parsed[1]);
  }
  return names;
}

function classifyContractExport(key, value) {
  const types = value && typeof value.types === "string" ? value.types : "";
  const source = value && typeof value.default === "string" ? value.default : "";
  const typescript = /^\.\/src\/([a-zA-Z0-9][a-zA-Z0-9-]*)\.ts$/.exec(source);
  if (typescript && types === source && (key === "." || key === `./${typescript[1]}`)) {
    return { key, kind: "typescript", name: typescript[1] };
  }
  const javascript = /^\.\/src\/([a-zA-Z0-9][a-zA-Z0-9-]*)\.js$/.exec(source);
  const declaration = /^\.\/src\/([a-zA-Z0-9][a-zA-Z0-9-]*)\.d\.ts$/.exec(types);
  if (
    javascript &&
    declaration &&
    javascript[1] === declaration[1] &&
    key === `./${javascript[1]}`
  ) {
    return { key, kind: "javascript", name: javascript[1] };
  }
  throw new Error(`Unsupported contracts source export: ${key}`);
}

function bundleContractModule(sourceDirectory, entryName) {
  const modules = new Map();
  const order = [];
  const stack = [];
  const visit = (name) => {
    if (stack.includes(name)) throw new Error(`Contract module cycle: ${name}`);
    if (modules.has(name)) return;
    if (!MODULE_NAME.test(name)) throw new Error(`Unsupported contract module name: ${name}`);
    stack.push(name);
    const parsed = readContractModule(sourceDirectory, name);
    for (const specifier of new Set(parsed.imports.values())) visit(specifier);
    stack.pop();
    modules.set(name, parsed);
    order.push(name);
  };
  visit(entryName);
  const chunks = ['"use strict";'];
  for (const name of order) {
    const parsed = modules.get(name);
    const binding = contractBinding(name);
    const grouped = new Map();
    for (const [imported, specifier] of parsed.imports) {
      const names = grouped.get(specifier) ?? [];
      names.push(imported);
      grouped.set(specifier, names);
    }
    const header = [...grouped]
      .map(([specifier, names]) => `const { ${names.join(", ")} } = ${contractBinding(specifier)};`)
      .join("\n");
    chunks.push(
      `const ${binding} = (() => {\n${header}\n${parsed.body}\nreturn { ${parsed.exported.join(", ")} };\n})();`,
    );
  }
  chunks.push(`module.exports = ${contractBinding(entryName)};\n`);
  return {
    javascript: `${chunks.join("\n")}\n`,
    declaration: readContractDeclaration(sourceDirectory, entryName),
  };
}

function contractBinding(name) {
  return `__aivora_${name.replaceAll("-", "_")}`;
}

function readContractModule(sourceDirectory, name) {
  const source = readContainedContract(sourceDirectory, `${name}.js`);
  if (source.length > 262_144) throw new Error(`Contract module is too large: ${name}`);
  const normalized = source.replaceAll("\r\n", "\n");
  const imports = new Map();
  const exported = [];
  let body = normalized.replace(
    /^import\s+\{([^}]+)\}\s+from\s+"(\.\/[a-zA-Z0-9][a-zA-Z0-9-]*\.js)";\n/gm,
    (_, names, specifier) => {
      rememberImports(imports, names, specifier, name);
      return "";
    },
  );
  body = body.replace(
    /^export\s+\{([^}]+)\}\s+from\s+"(\.\/[a-zA-Z0-9][a-zA-Z0-9-]*\.js)";\n/gm,
    (_, names, specifier) => {
      for (const imported of rememberImports(imports, names, specifier, name)) {
        if (!exported.includes(imported)) exported.push(imported);
      }
      return "";
    },
  );
  body = body.replace(/^export function ([A-Za-z_$][A-Za-z0-9_$]*)/gm, (_, exportedName) => {
    if (!exported.includes(exportedName)) exported.push(exportedName);
    return `function ${exportedName}`;
  });
  body = body.replace(/^export const ([A-Za-z_$][A-Za-z0-9_$]*)(?=\s*=)/gm, (_, exportedName) => {
    if (!exported.includes(exportedName)) exported.push(exportedName);
    return `const ${exportedName}`;
  });
  if (/^export\s+(?!function\b|const\b|\{)/m.test(normalized)) {
    throw new Error(`Unsupported contract export syntax: ${name}`);
  }
  if (/^\s*(?:import|export)\b/m.test(body)) {
    throw new Error(`Unsupported contract module syntax: ${name}`);
  }
  if (/\brequire\s*\(|\bimport\s*\(/.test(body)) {
    throw new Error(`Contract module cannot load code dynamically: ${name}`);
  }
  if (!exported.length) throw new Error(`Contract module has no exports: ${name}`);
  return { body, imports, exported };
}

function rememberImports(imports, names, specifier, moduleName) {
  const dependency = /^\.\/([a-zA-Z0-9][a-zA-Z0-9-]*)\.js$/.exec(specifier);
  if (!dependency) throw new Error(`Unsupported contract import in ${moduleName}`);
  const recorded = [];
  for (const raw of names.split(",")) {
    const imported = raw.trim();
    if (!imported) continue;
    if (!IDENTIFIER.test(imported)) throw new Error(`Unsupported contract import in ${moduleName}`);
    const previous = imports.get(imported);
    if (previous && previous !== dependency[1]) {
      throw new Error(`Contract import conflict in ${moduleName}: ${imported}`);
    }
    imports.set(imported, dependency[1]);
    recorded.push(imported);
  }
  return recorded;
}

function readContractDeclaration(sourceDirectory, name) {
  const source = readContainedContract(sourceDirectory, `${name}.d.ts`);
  if (source.length > 262_144) throw new Error(`Contract declaration is too large: ${name}`);
  if (/(?:\.\.\/|require\s*\()/.test(source)) {
    throw new Error(`Contract declaration escaped its module: ${name}`);
  }
  return source.endsWith("\n") ? source : `${source}\n`;
}

function readContainedContract(sourceDirectory, filename) {
  const path = join(sourceDirectory, filename);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) {
    throw new Error(`Contract module source is missing: ${filename}`);
  }
  const real = realpathSync(path);
  const inside = relative(realpathSync(sourceDirectory), real);
  if (
    isAbsolute(inside) ||
    inside === ".." ||
    inside.startsWith(`..${sep}`) ||
    inside !== filename
  ) {
    throw new Error(`Contract module source escaped its directory: ${filename}`);
  }
  return readFileSync(real, "utf8");
}
