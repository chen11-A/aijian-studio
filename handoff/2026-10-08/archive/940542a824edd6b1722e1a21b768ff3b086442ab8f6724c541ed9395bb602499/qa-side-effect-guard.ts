import { afterAll, vi } from "vitest";
import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const restore: Array<() => void> = [];
const deny = (): never => {
  throw new Error("QA_FORBIDDEN_NETWORK_CALL");
};

function block(moduleName: string, names: string[]): void {
  const module = require(moduleName) as Record<string, unknown>;
  for (const name of names) {
    const original = module[name];
    module[name] = deny;
    restore.push(() => { module[name] = original; });
  }
}

block("node:net", ["connect", "createConnection"]);
block("node:tls", ["connect"]);
block("node:http", ["request", "get"]);
block("node:https", ["request", "get"]);
block("node:dgram", ["createSocket"]);
block("node:dns", ["lookup", "resolve", "resolve4", "resolve6"]);
block("node:dns/promises", ["lookup", "resolve", "resolve4", "resolve6"]);
syncBuiltinESMExports();
vi.stubGlobal("fetch", deny);
vi.stubGlobal("WebSocket", deny);
vi.stubGlobal("EventSource", deny);
vi.stubGlobal("__QA_NETWORK_GUARD_ACTIVE__", true);

afterAll(() => {
  vi.unstubAllGlobals();
  for (const undo of restore.reverse()) undo();
  syncBuiltinESMExports();
});
