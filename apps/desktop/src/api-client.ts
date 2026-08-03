import type { components } from "@aijian/contracts";

type HealthResponse = components["schemas"]["HealthResponse"];
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface LocalApiClient {
  getHealth(): Promise<HealthResponse>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalLoopbackOrigin(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Local API URL must be a canonical loopback origin");
  }

  const isCanonical =
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";
  if (!isCanonical) {
    throw new Error("Local API URL must be a canonical loopback origin");
  }
  return url.origin;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.request_id !== "string" || !UUID_PATTERN.test(candidate.request_id)) {
    return false;
  }
  if (typeof candidate.data !== "object" || candidate.data === null) return false;
  const data = candidate.data as Record<string, unknown>;
  return data.status === "ok" && data.service === "aijian-api" && typeof data.version === "string";
}

export function createLocalApiClient(fetcher: Fetcher, baseUrl: string): LocalApiClient {
  const origin = canonicalLoopbackOrigin(baseUrl);

  return {
    async getHealth(): Promise<HealthResponse> {
      const response = await fetcher(`${origin}/api/v1/health`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Local API health request failed with status ${response.status}`);
      }
      const payload: unknown = await response.json();
      if (!isHealthResponse(payload)) {
        throw new Error("Local API health response does not match the published contract");
      }
      return payload;
    },
  };
}
