import type { components } from "@aijian/contracts";
import { describe, expect, test, vi } from "vitest";

import { createLocalApiClient } from "./api-client";

type HealthResponse = components["schemas"]["HealthResponse"];

const healthyResponse: HealthResponse = {
  data: { status: "ok", service: "aijian-api", version: "0.1.0" },
  request_id: "88ed7974-adc3-4e35-a5c8-38b9674fc45c",
};

const session = {
  origin: "http://127.0.0.1:43123",
  token: "s".repeat(43),
};

describe("local API client", () => {
  test("requests health only from the configured loopback origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(healthyResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getHealth()).resolves.toEqual(healthyResponse);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:43123/api/v1/health", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        Origin: "app://aijian",
      },
    });
  });

  test.each([
    "not-a-url",
    "https://127.0.0.1:43123",
    "http://127.0.0.1",
    "http://localhost:43123",
    "http://0.0.0.0:43123",
    "http://example.com:43123",
    "http://user:password@127.0.0.1:43123",
  ])("rejects a non-canonical local API URL: %s", (origin) => {
    expect(() => createLocalApiClient(vi.fn(), { ...session, origin })).toThrow(
      "canonical loopback",
    );
  });

  test("rejects a weak sidecar token", () => {
    expect(() => createLocalApiClient(vi.fn(), { ...session, token: "short" })).toThrow(
      "valid sidecar session",
    );
  });

  test("rejects HTTP failures and malformed health payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "ok" } })));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getHealth()).rejects.toThrow("status 502");
    await expect(client.getHealth()).rejects.toThrow("published contract");
  });
});
