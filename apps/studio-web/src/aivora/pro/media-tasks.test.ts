import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { grokBridge } from "../grok-auth/transport";
import { taskSnapshot } from "../film/task-progress";
import { exportFilmTask, revoiceFilmShot } from "./media-tasks";
vi.mock("../grok-auth/transport", () => ({ grokBridge: vi.fn() }));
afterEach(() => {
  delete window.aijian;
  vi.clearAllMocks();
});
const baseFilm = () => {
  const base = sampleFilm();
  base.characters[0]!.voiceId = "leo";
  base.shots[0] = {
    ...base.shots[0]!,
    line: "走吧。",
    lines: [{ speaker: base.characters[0]!.name, text: "走吧。" }],
    speaker: base.characters[0]!.name,
    characters: [base.characters[0]!.name],
  };
  return base;
};
const installVoice = (speak: ReturnType<typeof vi.fn>) =>
  vi
    .mocked(grokBridge)
    .mockReturnValue({ speak } as unknown as NonNullable<ReturnType<typeof grokBridge>>);
const installExport = (overrides = {}) => {
  window.aijian = {
    pickFilmFolder: vi.fn().mockResolvedValue("/out"),
    exportFilmCut: vi.fn().mockResolvedValue({ path: "/out/movie.mp4" }),
    ...overrides,
  } as unknown as NonNullable<typeof window.aijian>;
};
it("queues voice before billing and records done only after saving the real response", async () => {
  const base = baseFilm();
  const speak = vi
    .fn()
    .mockResolvedValue({ kind: "OK", audioBase64: "YQ==", mime: "audio/mpeg", seconds: 2 });
  installVoice(speak);
  const apply = vi.fn(),
    billing = vi.fn().mockResolvedValue("prj_test");
  const pending = revoiceFilmShot(base, base.shots[0]!, {
    current: () => base,
    valid: () => true,
    apply,
    billing,
  });
  expect(billing).not.toHaveBeenCalled();
  expect(
    taskSnapshot().tasks.some((task) => task.kind === "voice" && task.status === "queued"),
  ).toBe(true);
  await pending;
  expect(apply.mock.calls[0]![0].audioClips.at(-1).path).toBe("data:audio/mpeg;base64,YQ==");
  expect(taskSnapshot().tasks.some((task) => task.kind === "voice" && task.status === "done")).toBe(
    true,
  );
});
it("voice supplier failure is a failed task without a project write", async () => {
  const base = baseFilm(),
    apply = vi.fn();
  installVoice(vi.fn().mockResolvedValue({ kind: "ERROR", detail: "denied" }));
  await expect(
    revoiceFilmShot(base, base.shots[0]!, {
      current: () => base,
      valid: () => true,
      apply,
      billing: async () => "prj_test",
    }),
  ).rejects.toThrow("denied");
  expect(apply).not.toHaveBeenCalled();
  expect(
    taskSnapshot().tasks.some((task) => task.kind === "voice" && task.status === "failed"),
  ).toBe(true);
});
it("rejects absent voice traits and missing membership before speech", async () => {
  const base = baseFilm();
  const speak = vi.fn();
  installVoice(speak);
  const host = { current: () => base, valid: () => true, apply: vi.fn(), billing: async () => "" };
  await expect(revoiceFilmShot(base, base.shots[0]!, host)).rejects.toThrow("Grok");
  base.characters[0]!.voiceId = "";
  await expect(
    revoiceFilmShot(base, base.shots[0]!, { ...host, billing: async () => "prj_test" }),
  ).rejects.toThrow("VOICE_TRAITS_REQUIRED");
  expect(speak).not.toHaveBeenCalled();
});
it("does not save late voice after project switch", async () => {
  const base = baseFilm();
  let valid = true;
  let resolve!: (value: unknown) => void;
  installVoice(
    vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  );
  const apply = vi.fn();
  const pending = revoiceFilmShot(base, base.shots[0]!, {
    current: () => base,
    valid: () => valid,
    apply,
    billing: async () => "prj_test",
  });
  await vi.waitFor(() => expect(resolve).toBeDefined());
  valid = false;
  resolve({ kind: "OK", audioBase64: "YQ==" });
  await expect(pending).rejects.toThrow("WORK_STALE");
  expect(apply).not.toHaveBeenCalled();
});
it("queues export before directory selection and saves successful output", async () => {
  const base = baseFilm(),
    apply = vi.fn();
  installExport();
  const pending = exportFilmTask(base, ["clip.mp4"], "", {
    current: () => base,
    valid: () => true,
    apply,
  });
  expect(window.aijian!.pickFilmFolder).not.toHaveBeenCalled();
  expect(
    taskSnapshot().tasks.some((task) => task.kind === "export" && task.status === "queued"),
  ).toBe(true);
  await expect(pending).resolves.toEqual({ path: "/out/movie.mp4", directory: "/out" });
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ exportPath: "/out/movie.mp4" }));
  expect(
    taskSnapshot().tasks.some((task) => task.kind === "export" && task.status === "done"),
  ).toBe(true);
});
it("directory cancellation fails export task without writing", async () => {
  const base = baseFilm(),
    apply = vi.fn();
  installExport({ pickFilmFolder: vi.fn().mockResolvedValue(null) });
  await expect(
    exportFilmTask(base, ["clip.mp4"], "", { current: () => base, valid: () => true, apply }),
  ).rejects.toThrow("没有选择文件夹");
  expect(apply).not.toHaveBeenCalled();
  expect(
    taskSnapshot().tasks.some((task) => task.kind === "export" && task.status === "failed"),
  ).toBe(true);
});
it("retains assembled output and rejects missing assembly or failed export", async () => {
  const base = baseFilm(),
    apply = vi.fn(),
    host = { current: () => base, valid: () => true, apply };
  installExport({ assembleFilm: vi.fn().mockResolvedValue({ path: "/joined.mp4" }) });
  await exportFilmTask(base, ["one.mp4", "two.mp4"], "/out", host);
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ assemblyPath: "/joined.mp4" }));
  installExport();
  await expect(exportFilmTask(base, ["one", "two"], "/out", host)).rejects.toThrow("多镜头");
  installExport({ exportFilmCut: vi.fn().mockResolvedValue({ path: "" }) });
  await expect(exportFilmTask(base, ["one"], "/out", host)).rejects.toThrow("没有导出成功");
  await expect(exportFilmTask(base, [], "/out", host)).rejects.toThrow("没有导出成功");
  delete window.aijian;
  await expect(exportFilmTask(base, ["one"], "/out", host)).rejects.toThrow("桌面版");
});
it("rejects late export without saving into another project", async () => {
  const base = baseFilm(),
    apply = vi.fn();
  let valid = true;
  let resolve!: (value: { path: string }) => void;
  installExport({
    exportFilmCut: vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  });
  const pending = exportFilmTask(base, ["one"], "/out", {
    current: () => base,
    valid: () => valid,
    apply,
  });
  await vi.waitFor(() => expect(resolve).toBeDefined());
  valid = false;
  resolve({ path: "/old.mp4" });
  await expect(pending).rejects.toThrow("WORK_STALE");
  expect(apply).not.toHaveBeenCalled();
});
