// Test-only executable lookup; subprocess invocation always uses argument arrays.
import process from "node:process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

export default function which(binary) {
  const directories =
    isAbsolute(binary) || /[/\\]/.test(binary) ? [""] : (process.env.PATH ?? "").split(delimiter);
  const suffixes =
    process.platform === "win32" && !binary.toLowerCase().endsWith(".exe") ? ["", ".exe"] : [""];
  for (const directory of directories)
    for (const suffix of suffixes) {
      const candidate = resolve(join(directory, binary + suffix));
      if (existsSync(candidate)) return candidate;
    }
  throw new Error("Test executable could not be resolved");
}
