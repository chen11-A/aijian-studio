import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { App } from "./App";
import type { HealthTransport } from "./api/health";

const healthyResponse = {
  data: {
    status: "ok" as const,
    service: "aijian-api" as const,
    version: "0.1.0",
  },
  request_id: "9e049ad6-2b22-4e2d-8d48-e5bd78ee0e11",
};

function transportReturning(result: typeof healthyResponse): HealthTransport {
  return { getHealth: vi.fn().mockResolvedValue(result) };
}

test("shows the connected workspace when the API responds", async () => {
  render(<App transport={transportReturning(healthyResponse)} />);

  expect(screen.getByText("正在连接创作引擎…")).toBeInTheDocument();
  expect(await screen.findByText("创作引擎已连接")).toBeInTheDocument();
  expect(screen.getByText("aijian-api · v0.1.0")).toBeInTheDocument();
});

test("shows a recoverable error when the API is unavailable", async () => {
  const getHealth = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(healthyResponse);

  render(<App transport={{ getHealth }} />);

  expect(await screen.findByText("创作引擎未连接")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新连接" }));

  await waitFor(() => expect(getHealth).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("创作引擎已连接")).toBeInTheDocument();
});
