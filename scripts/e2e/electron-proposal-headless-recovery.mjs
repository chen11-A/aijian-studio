/* global process */

process.argv.push("proposal");
await import("./electron-headless-operation-recovery.mjs");
