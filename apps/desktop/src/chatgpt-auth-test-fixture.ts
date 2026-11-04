import { generateKeyPairSync, sign } from "node:crypto";
import { vi } from "vitest";
import type { Fetch } from "./chatgpt-auth-http";
import { ISSUER, TOKEN } from "./chatgpt-auth-oauth";
// Ephemeral local cryptographic fixtures. No OpenAI account or credential is used.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const jwk = {
  ...keys.publicKey.export({ format: "jwk" }),
  kid: "local-fixture",
  use: "sig",
  alg: "RS256",
};
export function signedIdentity(
  overrides: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "local-fixture", ...header }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      sub: "fixture-subject",
      aud: "oaiapp_fixture",
      nonce: "fixture-nonce",
      iat: now,
      exp: now + 3600,
      email: "fixture@example.test",
      ...overrides,
    }),
  ).toString("base64url");
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), keys.privateKey).toString("base64url")}`;
}
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
export function fixtureFetch(tokenResponse?: Record<string, unknown>) {
  return vi.fn<Fetch>(async (url) => {
    if (String(url).endsWith("openid-configuration"))
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
        token_endpoint: TOKEN,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
      });
    if (String(url).endsWith("jwks.json")) return json({ keys: [jwk] });
    if (String(url) === TOKEN)
      return json(
        tokenResponse ?? {
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          id_token: signedIdentity(),
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid resource.invoke chatgpt.tokens.use.direct",
        },
      );
    if (String(url).endsWith("/models"))
      return json({
        models: [
          { slug: "fixture-text", display_name: "Fixture text", visibility: "list" },
          { slug: "hidden", display_name: "Hidden", visibility: "hide" },
        ],
      });
    if (String(url).endsWith("/revoke")) return new Response(null, { status: 200 });
    throw new Error("External network forbidden in this fixture");
  });
}
