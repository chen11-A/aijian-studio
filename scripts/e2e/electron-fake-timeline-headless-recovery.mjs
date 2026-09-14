/* global process */

process.argv.push("fake-timeline");
await import("./electron-headless-operation-recovery.mjs");
