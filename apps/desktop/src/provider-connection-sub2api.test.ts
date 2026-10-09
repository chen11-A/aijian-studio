import { describe, expect, test } from "vitest";
import {
  isCreateProviderConnectionInput,
  isExactLocalSub2APIOrigin,
  isProviderConnectionListResponse,
  isSub2APIOriginMode,
} from "./provider-connection-contract";

const input = {
  provider_kind: "SUB2API",
  display_name: "Synthetic text connection",
  base_url: "https://text.example.com",
  origin_mode: "PUBLIC_HTTPS",
  enabled: true,
  models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
  api_key: "synthetic-test-key",
};

describe("Sub2API creation boundary", () => {
  test.each([
    "https://text.example.com",
    "https://text.example.com/",
    "https://8.8.8.8",
    "https://[2606:4700:4700::1111]",
  ])("accepts public HTTPS origin syntax without claiming DNS verification: %s", (base_url) => {
    expect(isCreateProviderConnectionInput({ ...input, base_url })).toBe(true);
  });

  test.each([
    "https://localhost",
    "https://intranet",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://169.254.1.1",
    "https://127.0.0.1",
    "https://0.0.0.0",
    "https://224.0.0.1",
    "https://[::]",
    "https://[::1]",
    "https://[fc00::1]",
    "https://[fe80::1]",
    "https://[ff02::1]",
    "https://text.example.com/v1",
    "http://127.0.0.1:8080",
    "https://text.example.com\\path",
  ])("rejects private or path-bearing public mode origin %s", (base_url) => {
    expect(isCreateProviderConnectionInput({ ...input, base_url })).toBe(false);
  });

  test.each([
    { api_key: "synthetic key" },
    { base_url: `https://${"a".repeat(2040)}.example.com` },
    { models: [{ model_id: " padded ", capabilities: ["TEXT"] }] },
    { models: [{ model_id: "image-model", capabilities: ["IMAGE"] }] },
    { models: [{ model_id: "mixed", capabilities: ["TEXT", "IMAGE"] }] },
    { models: [...input.models, ...input.models] },
    { origin_mode: null },
    { origin_mode: "IMPLICIT" },
  ])("rejects noncanonical text configuration %#", (change) => {
    expect(isCreateProviderConnectionInput({ ...input, ...change })).toBe(false);
  });

  test.each(["http://127.0.0.1:1", "http://[::1]:65535"])(
    "requires explicit local mode for loopback %s",
    (base_url) => {
      expect(isCreateProviderConnectionInput({ ...input, base_url })).toBe(false);
      expect(
        isCreateProviderConnectionInput({
          ...input,
          base_url,
          origin_mode: "LOCAL_LOOPBACK_HTTP",
        }),
      ).toBe(true);
    },
  );

  test.each([
    null,
    "",
    "http://localhost:80",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:080",
    "http://127.0.0.1:80/",
    "https://127.0.0.1:80",
  ])("rejects noncanonical local origin %s", (base_url) => {
    expect(isExactLocalSub2APIOrigin(base_url)).toBe(false);
  });

  test("validates response origin modes independently from secret-bearing create requests", () => {
    expect(isSub2APIOriginMode("PUBLIC_HTTPS")).toBe(true);
    expect(isSub2APIOriginMode("LOCAL_LOOPBACK_HTTP")).toBe(true);
    expect(isSub2APIOriginMode(undefined)).toBe(false);
    const data = {
      provider_kind: input.provider_kind,
      display_name: input.display_name,
      base_url: input.base_url,
      origin_mode: input.origin_mode,
      enabled: input.enabled,
      models: input.models,
      id: `pcn_${"a".repeat(32)}`,
      revision: 1,
      credential_status: "CONFIGURED",
      created_at: "2026-09-14T00:00:00Z",
      updated_at: "2026-09-14T00:00:00Z",
    };
    const response = (change: object) => ({
      request_id: "123e4567-e89b-42d3-a456-426614174000",
      data: [{ ...data, ...change }],
    });
    expect(isProviderConnectionListResponse(response({}))).toBe(true);
    expect(
      isProviderConnectionListResponse(
        response({
          origin_mode: "LOCAL_LOOPBACK_HTTP",
          base_url: "http://127.0.0.1:8080",
        }),
      ),
    ).toBe(true);
    expect(isProviderConnectionListResponse(response({ origin_mode: null }))).toBe(false);
    expect(
      isProviderConnectionListResponse(response({ base_url: "http://text.example.com" })),
    ).toBe(false);
    expect(
      isProviderConnectionListResponse(
        response({
          origin_mode: "LOCAL_LOOPBACK_HTTP",
          base_url: "http://localhost:8080",
        }),
      ),
    ).toBe(false);
  });
});
