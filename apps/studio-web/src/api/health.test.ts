import { afterEach, describe, expect, test, vi } from "vitest";

import { createHealthTransport, type HealthResponse } from "./health";

const health: HealthResponse = {
  data: { status: "ok", service: "aijian-api", version: "0.1.0" },
  request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
};

afterEach(() => {
  delete window.aijian;
  vi.unstubAllGlobals();
});

describe("health transport", () => {
  test("uses the Electron preload bridge when it is available", async () => {
    const desktopHealth = vi.fn().mockResolvedValue(health);
    window.aijian = { health: desktopHealth };

    await expect(createHealthTransport().getHealth()).resolves.toEqual(health);
    expect(desktopHealth).toHaveBeenCalledOnce();
  });

  test("uses the same-origin API in a browser", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(health), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHealthTransport().getHealth()).resolves.toEqual(health);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/health", {
      headers: { Accept: "application/json" },
    });
  });

  test("rejects HTTP errors and malformed payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createHealthTransport();

    await expect(transport.getHealth()).rejects.toThrow("status 503");
    await expect(transport.getHealth()).rejects.toThrow("published contract");
  });
});
