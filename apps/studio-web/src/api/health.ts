import type { components } from "@aijian/contracts";

export type HealthResponse = components["schemas"]["HealthResponse"];

export interface HealthTransport {
  getHealth(): Promise<HealthResponse>;
}

export interface AijianDesktopBridge {
  health(): Promise<HealthResponse>;
}

declare global {
  interface Window {
    aijian?: AijianDesktopBridge;
  }
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.request_id !== "string") return false;
  if (typeof candidate.data !== "object" || candidate.data === null) return false;
  const data = candidate.data as Record<string, unknown>;
  return (
    data.status === "ok" &&
    data.service === "aijian-api" &&
    typeof data.version === "string"
  );
}

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isHealthResponse(payload)) {
    throw new Error("Health response does not match the published contract");
  }
  return payload;
}

export function createHealthTransport(): HealthTransport {
  if (window.aijian) {
    return { getHealth: () => window.aijian!.health() };
  }
  return { getHealth: fetchHealth };
}
