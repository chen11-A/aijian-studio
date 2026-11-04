import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
export async function run(binary, args, options = {}) {
  return execute(
    binary.includes("/") || binary.includes("\\") ? path.resolve(binary) : binary,
    args,
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 600000, ...options },
  );
}
