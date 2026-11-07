import { createRequire, isBuiltin } from "node:module";
import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import ts from "typescript";
import { createRuntimeResourceAudit } from "./desktop-runtime-resources.mjs";

/** Shared by the real app builder and both Linux staged layouts. Never executes
 * main/preload, grants provider access, or replaces the collectors. */
export function verifyDesktopRuntime(appDirectory, resourcesDirectory) {
  const root = realpathSync.native(appDirectory);
  const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (typeof app.main !== "string" || app.main !== "dist/main.js")
    throw Error("Unexpected runtime main");
  const audit = createRuntimeResourceAudit(resourcesDirectory);
  const pending = [join(root, app.main), join(root, "dist/preload.js")],
    visited = new Set(),
    external = new Set();
  while (pending.length) {
    const raw = pending.pop();
    if (lstatSync(raw).isSymbolicLink()) throw Error("Runtime import is a link");
    const path = realpathSync.native(raw),
      part = relative(root, path);
    if (!part || isAbsolute(part) || part === ".." || part.startsWith(`..${sep}`))
      throw Error("Runtime import escaped application tree");
    if (visited.has(path)) continue;
    visited.add(path);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    );
    const requireFromFile = createRequire(path);
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
          node.expression.kind === ts.SyntaxKind.ImportKeyword)
      ) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
          audit.resolveImport(root, source, node);
        } else {
          const specifier = node.arguments[0].text;
          if (specifier === "electron" || isBuiltin(specifier)) external.add(specifier);
          else {
            const target = realpathSync.native(requireFromFile.resolve(specifier)),
              inside = relative(root, target);
            if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`))
              throw Error("Runtime import escaped application tree");
            if (target.endsWith(".js")) pending.push(target);
            else if (!target.endsWith(".json"))
              throw Error("Unexpected runtime dependency needs review");
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return {
    reachable_js_files: visited.size,
    host_modules: [...external].sort(),
    bundled_resource_closure: audit.finish(),
  };
}
