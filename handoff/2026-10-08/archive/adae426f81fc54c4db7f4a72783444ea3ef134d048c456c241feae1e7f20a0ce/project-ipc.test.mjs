import { beforeAll, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const handlers = new Map();
  const mainFrame = { identity: "main" };
  const webContents = {
    mainFrame,
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
  };
  const mainWindow = {
    webContents,
    once: vi.fn(),
    on: vi.fn(),
    loadFile: vi.fn(async () => undefined),
    show: vi.fn(),
  };
  const updateProject = vi.fn(async (_id, _command) => ({ kind: "SUCCEEDED", receipt: { request_id: "test", data: {} } }));
  const client = { updateProject };
  return { handlers, mainFrame, webContents, mainWindow, updateProject, client };
});

vi.mock("@qa-desktop/sidecar-process.ts", () => ({
  startSidecar: vi.fn(async () => ({ session: { token: "test" }, stop: vi.fn(async () => undefined) })),
}));
vi.mock("@qa-desktop/api-client.ts", () => ({
  createLocalApiClient: vi.fn(() => fixture.client),
}));

beforeAll(async () => {
  globalThis.__qaIpcFixture = fixture;
  await import("@qa-desktop/main.ts");
  await vi.waitFor(() => expect(fixture.mainWindow.loadFile).toHaveBeenCalledOnce());
});

const projectId = "prj_" + "a".repeat(32);
const command = { expectedRevision: 7, name: "新名" };
function handler() {
  const value = fixture.handlers.get("projects:update");
  expect(value).toBeTypeOf("function");
  return value;
}

test("top frame forwards a normalized project update once", async () => {
  const result = await handler()({ sender: fixture.webContents, senderFrame: fixture.mainFrame }, projectId, command);
  expect(result.kind).toBe("SUCCEEDED");
  expect(fixture.updateProject).toHaveBeenCalledWith(projectId, command);
  expect(fixture.updateProject).toHaveBeenCalledTimes(1);
});

test("child frame and foreign webContents cannot reach project mutation", async () => {
  expect(() => handler()({ sender: fixture.webContents, senderFrame: {} }, projectId, command))
    .toThrow(/sender frame is not authorized/);
  expect(() => handler()({ sender: {}, senderFrame: fixture.mainFrame }, projectId, command))
    .toThrow(/Local API is not available/);
  expect(fixture.updateProject).toHaveBeenCalledTimes(1);
});

test("invalid ID, command, and argument count do not call the client", async () => {
  const top = { sender: fixture.webContents, senderFrame: fixture.mainFrame };
  expect(await handler()(top, "invalid", command)).toEqual({ kind: "INVALID_INPUT" });
  expect(await handler()(top, projectId, { expectedRevision: 0, name: "新名" })).toEqual({ kind: "INVALID_INPUT" });
  expect(await handler()(top, projectId, command, "extra")).toEqual({ kind: "INVALID_INPUT" });
  expect(fixture.updateProject).toHaveBeenCalledTimes(1);
});
