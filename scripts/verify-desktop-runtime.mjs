// Audit a packager's actual emitted application and collector resource layout.
import process from "node:process";
import { isAbsolute } from "node:path";
import { verifyDesktopRuntime } from "./desktop-runtime-closure.mjs";
const args = process.argv.slice(2);
if (
  args.length !== 4 ||
  args[0] !== "--app-dir" ||
  args[2] !== "--resources-root" ||
  !isAbsolute(args[1]) ||
  !isAbsolute(args[3])
)
  throw Error("Expected fixed app and collected resources directories");
process.stdout.write(
  JSON.stringify(
    {
      schema_version: 1,
      result: "RUNTIME_CLOSURE_ONLY",
      ...verifyDesktopRuntime(args[1], args[3]),
      electron_execution: "NOT_RUN",
      windows_execution: "NOT_RUN",
      release_approved: false,
    },
    null,
    2,
  ) + "\n",
);
