const fs = require("node:fs");
const path = require("node:path");

const [mode, capturePath] = process.argv.slice(2);
if (!mode || !capturePath) process.exit(90);

fs.writeFileSync(capturePath, JSON.stringify({
  mode,
  pid: process.pid,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  forbiddenPresent: Object.hasOwn(process.env, "AIVORA_QA02_FORBIDDEN"),
}), "utf8");

if (mode === "ready") {
  process.stdout.write(`${JSON.stringify({
    event: "ready",
    host: "127.0.0.1",
    pid: process.pid,
    port: 43123,
    protocol_version: 1,
    token: "q".repeat(43),
  })}\n`);
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (mode === "busy") {
  process.stderr.write("AIVORA_STARTUP_WORKSPACE_BUSY\n", () => process.exit(73));
} else if (mode === "false-busy") {
  process.stderr.write("prefix AIVORA_STARTUP_WORKSPACE_BUSY\n", () => process.exit(73));
} else if (mode === "wrong-code") {
  process.stderr.write("AIVORA_STARTUP_WORKSPACE_BUSY\n", () => process.exit(1));
} else if (mode === "timeout") {
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (mode === "survivor") {
  const survivor = path.join(process.env.TEMP, "_MEIqa02", "survivor.txt");
  fs.mkdirSync(path.dirname(survivor), { recursive: true });
  fs.writeFileSync(survivor, "QA02 fake child survivor", "utf8");
  process.stderr.write("AIVORA_STARTUP_WORKSPACE_BUSY\n", () => process.exit(73));
} else {
  process.exit(91);
}
