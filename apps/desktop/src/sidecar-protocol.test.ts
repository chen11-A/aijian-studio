import { describe, expect, test } from "vitest";

import { parseSidecarHandshake } from "./sidecar-protocol";

const token = "A".repeat(43);

function handshake(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "ready",
    host: "127.0.0.1",
    pid: 7654,
    port: 43123,
    protocol_version: 1,
    token,
    ...overrides,
  });
}

describe("sidecar startup protocol", () => {
  test("accepts a strict versioned handshake and derives the local origin", () => {
    expect(parseSidecarHandshake(handshake())).toEqual({
      origin: "http://127.0.0.1:43123",
      pid: 7654,
      port: 43123,
      token,
    });
  });

  test.each([
    "not-json",
    handshake({ event: "log" }),
    handshake({ host: "localhost" }),
    handshake({ pid: 0 }),
    handshake({ port: "43123" }),
    handshake({ port: 0 }),
    handshake({ port: 65536 }),
    handshake({ protocol_version: 2 }),
    handshake({ token: "short" }),
    handshake({ extra: true }),
    `${handshake()}\n${handshake()}`,
  ])("rejects malformed or noncanonical input", (line) => {
    expect(() => parseSidecarHandshake(line)).toThrow("Invalid sidecar handshake");
  });

  test("never includes rejected secret material in its error", () => {
    const rejectedToken = "secret:value-that-must-never-appear-in-an-error";

    expect(() => parseSidecarHandshake(handshake({ token: rejectedToken }))).toThrow(
      new Error("Invalid sidecar handshake"),
    );
  });
});
