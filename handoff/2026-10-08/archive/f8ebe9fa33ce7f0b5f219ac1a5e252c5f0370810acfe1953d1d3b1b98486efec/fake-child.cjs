"use strict";
const fs = require("node:fs");
const report = process.env.QA_REPORT_PATH;
if (!report) throw new Error("Missing QA report path");
fs.writeFileSync(report, JSON.stringify({
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  pid: process.pid,
}) + "\n", {flag:"wx"});
process.stdout.write(JSON.stringify({
  event:"ready", host:"127.0.0.1", pid:process.pid, port:43123,
  protocol_version:1, token:"s".repeat(43),
}) + "\n");
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();

