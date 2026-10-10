import { describe, expect, it, vi } from "vitest";
import {
  boundedText,
  discover,
  listModels,
  readJson,
  requestTokens,
  verifyIdentity,
} from "./chatgpt-auth-http";
import { fixtureFetch, json, signedIdentity } from "./chatgpt-auth-test-fixture";
const signal = () => AbortSignal.timeout(5000);
describe("official token and catalog transport", () => {
  it("logs only the HTTP status and a fixed code, never response content", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(
        readJson(new Response("private-token-and-email", { status: 403 })),
      ).rejects.toThrow("OPENAI_REQUEST_FAILED");
      expect(warning).toHaveBeenCalledExactlyOnceWith("[chatgpt-http]", {
        status: 403,
        code: "OPENAI_REQUEST_FAILED",
      });
    } finally {
      warning.mockRestore();
    }
  });
  it("verifies signature, issuer, audience, time and nonce before exposing identity", async () => {
    expect(
      await verifyIdentity(
        signedIdentity(),
        "oaiapp_fixture",
        "fixture-nonce",
        fixtureFetch(),
        signal(),
      ),
    ).toEqual({
      issuer: "https://auth.openai.com",
      subject: "fixture-subject",
      email: "fixture@example.test",
    });
  });
  it.each([
    { iss: "https://malicious.example" },
    { aud: "wrong" },
    { aud: ["oaiapp_fixture", "other"] },
    { nonce: "wrong" },
    { sub: "" },
    { exp: 1 },
    { iat: 99_999_999_999 },
    { nbf: 99_999_999_999 },
  ])("rejects invalid signed claims %j", async (claims) => {
    await expect(
      verifyIdentity(
        signedIdentity(claims),
        "oaiapp_fixture",
        "fixture-nonce",
        fixtureFetch(),
        signal(),
      ),
    ).rejects.toThrow("IDENTITY_INVALID");
  });
  it("rejects unsigned tokens, changed signature and token-selected keys", async () => {
    for (const value of [
      "not-a-token",
      signedIdentity({}, { alg: "none" }),
      signedIdentity({}, { jku: "https://malicious.example" }),
      signedIdentity().replace(/.$/, "!"),
    ]) {
      await expect(
        verifyIdentity(value, "oaiapp_fixture", "fixture-nonce", fixtureFetch(), signal()),
      ).rejects.toThrow("IDENTITY_INVALID");
    }
  });
  it("allows valid multi-audience only with matching authorized party", async () => {
    await expect(
      verifyIdentity(
        signedIdentity({ aud: ["oaiapp_fixture", "other"], azp: "oaiapp_fixture" }),
        "oaiapp_fixture",
        "fixture-nonce",
        fixtureFetch(),
        signal(),
      ),
    ).resolves.toMatchObject({ subject: "fixture-subject" });
  });
  it("exchanges using exact public token route, never redirects or uses a client secret", async () => {
    const fetcher = fixtureFetch();
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: "fixture-code",
      client_id: "oaiapp_fixture",
    });
    const value = await requestTokens(form, fetcher, signal(), {
      clientId: "oaiapp_fixture",
      nonce: "fixture-nonce",
    });
    expect(value.scopes).toContain("chatgpt.tokens.use.direct");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", method: "POST" });
    expect(form.has("client_secret")).toBe(false);
  });
  it("retains identity-only login without falsely authorizing plan usage", async () => {
    const value = await requestTokens(
      new URLSearchParams(),
      fixtureFetch({ id_token: signedIdentity(), scope: "openid email profile" }),
      signal(),
      { clientId: "oaiapp_fixture", nonce: "fixture-nonce" },
    );
    expect(value.accessToken).toBeNull();
    expect(value.scopes).not.toContain("chatgpt.tokens.use.direct");
  });
  it("rejects malformed responses and hostile discovery routes", async () => {
    await expect(
      requestTokens(
        new URLSearchParams(),
        fixtureFetch({ access_token: "fixture", token_type: "MAC", scope: "openid" }),
        signal(),
        { clientId: "oaiapp_fixture", nonce: "fixture-nonce" },
      ),
    ).rejects.toThrow("TOKEN_RESPONSE_INVALID");
    await expect(
      discover(
        vi.fn(async () => json({ issuer: "https://evil.example" })),
        signal(),
      ),
    ).rejects.toThrow("DISCOVERY_INVALID");
    await expect(readJson(json({}, 401))).rejects.toThrow("REAUTH_REQUIRED");
    await expect(readJson(json({}, 429))).rejects.toThrow("USAGE_LIMIT");
    await expect(readJson(new Response("html"))).rejects.toThrow("RESPONSE_INVALID");
    await expect(boundedText(new Response("oversized"), 2)).rejects.toThrow("RESPONSE_TOO_LARGE");
  });
  it("uses account-specific model ordering and omits hidden models", async () => {
    const fetcher = fixtureFetch();
    expect(await listModels("fixture-access", fetcher, signal())).toEqual([
      { slug: "fixture-text", displayName: "Fixture text" },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/models");
    await expect(
      listModels(
        "fixture-access",
        vi.fn(async () => json({ data: [] })),
        signal(),
      ),
    ).rejects.toThrow("MODEL_CATALOG_INVALID");
  });
});

it("rejects malformed JWT segments, wrong signing keys and invalid signatures", async () => {
  const token = signedIdentity();
  const pieces = token.split(".");
  const signature = pieces[2] ?? "";
  pieces[2] = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
  for (const value of [
    "x".repeat(33000),
    "!.e30.AA",
    "e30.W10.AA",
    "e30.eA.AA",
    pieces.join("."),
  ]) {
    await expect(
      verifyIdentity(value, "oaiapp_fixture", "fixture-nonce", fixtureFetch(), signal()),
    ).rejects.toThrow("IDENTITY_INVALID");
  }
  for (const payload of [
    null,
    { keys: [] },
    { keys: [{ kid: "local-fixture", kty: "RSA", n: "AQAB", e: "AQAB" }] },
  ]) {
    const fetcher = fixtureFetch();
    const original = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("jwks.json")) return json(payload);
      if (!original) throw new Error("missing fixture");
      return original(url, init);
    });
    await expect(
      verifyIdentity(token, "oaiapp_fixture", "fixture-nonce", fetcher, signal()),
    ).rejects.toThrow("IDENTITY_INVALID");
  }
});
it("rejects malformed and oversized JSON and duplicate display models", async () => {
  await expect(readJson(json({}, 500))).rejects.toThrow("OPENAI_REQUEST_FAILED");
  await expect(
    readJson(new Response("{", { headers: { "Content-Type": "application/json" } })),
  ).rejects.toThrow("RESPONSE_INVALID");
  await expect(
    readJson(
      new Response("{}", {
        headers: { "Content-Type": "application/json", "Content-Length": "999999999" },
      }),
    ),
  ).rejects.toThrow("RESPONSE_INVALID");
  const model = { slug: "fixture", display_name: "Fixture", visibility: "list" };
  await expect(
    listModels(
      "fixture",
      vi.fn(async () => json({ models: [model, model] })),
      signal(),
    ),
  ).rejects.toThrow("MODEL_CATALOG_INVALID");
});
it("supports verified refresh without a new ID token and refuses account substitution", async () => {
  const previous = await requestTokens(new URLSearchParams(), fixtureFetch(), signal(), {
    clientId: "oaiapp_fixture",
    nonce: "fixture-nonce",
  });
  const response = {
    access_token: "fixture-renewed",
    token_type: "Bearer",
    expires_in: 60,
    scope: "openid resource.invoke chatgpt.tokens.use.direct",
  };
  const renewed = await requestTokens(new URLSearchParams(), fixtureFetch(response), signal(), {
    clientId: "oaiapp_fixture",
    nonce: null,
    previous,
  });
  expect(renewed.refreshToken).toBe(previous.refreshToken);
  expect(renewed.identity).toEqual(previous.identity);
  await expect(
    requestTokens(
      new URLSearchParams(),
      fixtureFetch({ ...response, id_token: signedIdentity({ sub: "other" }) }),
      signal(),
      { clientId: "oaiapp_fixture", nonce: null, previous },
    ),
  ).rejects.toThrow("ACCOUNT_MISMATCH");
  await expect(
    requestTokens(
      new URLSearchParams(),
      fixtureFetch({ ...response, refresh_token: "" }),
      signal(),
      { clientId: "oaiapp_fixture", nonce: null, previous },
    ),
  ).rejects.toThrow("TOKEN_RESPONSE_INVALID");
  await expect(
    requestTokens(new URLSearchParams(), fixtureFetch(response), signal(), {
      clientId: "oaiapp_fixture",
      nonce: null,
    }),
  ).rejects.toThrow("IDENTITY_INVALID");
});
