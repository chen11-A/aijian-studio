"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSidecarHandshake = parseSidecarHandshake;
const HANDSHAKE_KEYS = ["event", "host", "pid", "port", "protocol_version", "token"];
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,256}$/;
function isPlainRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalidHandshake() {
    throw new Error("Invalid sidecar handshake");
}
function parseSidecarHandshake(line) {
    if (line.length === 0 || line.length > 4096 || line.includes("\n") || line.includes("\r")) {
        return invalidHandshake();
    }
    let payload;
    try {
        payload = JSON.parse(line);
    }
    catch {
        return invalidHandshake();
    }
    if (!isPlainRecord(payload))
        return invalidHandshake();
    const keys = Object.keys(payload).sort();
    if (keys.length !== HANDSHAKE_KEYS.length ||
        !HANDSHAKE_KEYS.every((key, index) => keys[index] === key)) {
        return invalidHandshake();
    }
    const validPid = Number.isSafeInteger(payload.pid) && Number(payload.pid) > 0;
    const validPort = Number.isSafeInteger(payload.port) && Number(payload.port) > 0 && Number(payload.port) <= 65535;
    const validToken = typeof payload.token === "string" && TOKEN_PATTERN.test(payload.token);
    if (payload.event !== "ready" ||
        payload.host !== "127.0.0.1" ||
        payload.protocol_version !== 1 ||
        !validPid ||
        !validPort ||
        !validToken) {
        return invalidHandshake();
    }
    const port = Number(payload.port);
    return {
        origin: `http://127.0.0.1:${port}`,
        pid: Number(payload.pid),
        port,
        token: String(payload.token),
    };
}
