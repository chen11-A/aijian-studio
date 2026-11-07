import type { FilmGenerationExecutionGateway } from "@aijian/contracts/film-generation-execution";
import { sceneLocationTargets } from "../film/location-reference";
import type { FilmAssemblyInput, FilmAssemblyResult } from "@aijian/contracts/film-assembly";
import { historyRecordHash } from "./actions/persistent-history";
import type { FilmHistoryEntry, FilmHistoryReason } from "@aijian/contracts/film-history";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { blankFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";
const projectId = `prj_${"b".repeat(32)}`;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  delete window.aijian;
  delete window.aijianGrok;
  vi.unstubAllGlobals();
});
function fixture(partial = false, count = 1) {
  const film = blankFilm();
  film.title = "流水线回归";
  film.seriesTitle = film.title;
  film.sourceText =
    count === 1
      ? "雨停了。"
      : "雨停了，巷口的路面铺着细碎水光，街边木门紧闭，屋檐还在慢慢滴水，远处的车灯划过湿漉漉的石板，夜色重新安静下来。路灯下的积水映出窗沿，风吹动墙角的旧纸，细小涟漪缓缓散开，巷子的另一端逐渐亮起暖色灯火，雨后的空气清冷而明亮。";
  film.scenes[0]!.text = film.sourceText;
  film.scenes[0]!.where = "巷口 · 夜";
  film.characters = [];
  film.locations = [];
  film.shots = [];
  let saved: FilmProject = structuredClone(film);
  const order: string[] = [];
  const history: { entry: FilmHistoryEntry; snapshot: FilmProject }[] = [];
  const completeText = vi.fn(async ({ text }: { text: string }) => {
    order.push("member:text");
    let reply: unknown;
    if (text.includes("抽出人物和场景"))
      reply = { characters: [], locations: [{ name: "巷口", prompt: "雨停后的巷口" }] };
    else if (text.includes("写成短剧分场"))
      reply = {
        scenes: [
          {
            title: "雨停",
            place: "巷口",
            time: "夜",
            text: film.sourceText,
            source_paragraphs: ["P01"],
          },
        ],
      };
    else if (text.includes("写出画风"))
      reply = { prompt_block_zh: "雨夜冷色", identities: [], locations: [], props: [] };
    else if (text.includes("把这一场拆成镜头"))
      reply = {
        shots: Array.from({ length: count }, (_, i) => ({
          picture: film.sourceText,
          size: i === 0 ? "全景" : "近景",
          seconds: 3,
          characters: [],
          lines: [],
        })),
      };
    else if (text.includes("提示词") || text.includes("prompt_zh"))
      reply = { keyframe: { prompt_zh: "雨停了。", prompt_en: "The rain has stopped." } };
    else throw new Error("unexpected test agent request");
    return { kind: "OK", text: JSON.stringify(reply) };
  });
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "test",
      lastError: null,
    })),
    models: vi.fn(async () => ({
      kind: "OK",
      models: ["grok-4.7", "grok-imagine-image-2.0", "grok-imagine-video-1.5"].map((id) => ({
        id,
        label: id,
      })),
    })),
    completeText,
    cancelWork: vi.fn(async () => undefined),
  } as unknown as Window["aijianGrok"];
  const video = vi.fn(async (...args: unknown[]) => {
    const context = args[3] as {
      executionId: string;
      videoSlotId: string;
      shotId: string;
      takeId: string;
    };
    expect(args[0]).toBe(projectId);
    expect(context).toEqual({
      executionId: "native-pipeline",
      videoSlotId: `slot-${context.shotId}`,
      shotId: context.shotId,
      takeId: context.takeId,
    });
    expect(
      saved.shots
        .find((shot) => shot.id === context.shotId)
        ?.takes.some((take) => take.id === context.takeId),
    ).toBe(true);
    order.push("member:video");
    return {
      data: {
        status: "SUCCEEDED",
        output_path: "/tmp/pipeline-video.mp4",
        duration_seconds: 3,
        message: "",
      },
    };
  });
  const legacyAssemble = vi.fn();
  const assemble = vi.fn(async (input: FilmAssemblyInput): Promise<FilmAssemblyResult> => {
    expect(input.expectedHash).toBe(await historyRecordHash(saved));
    expect(input.projectId).toBe(saved.id);
    expect(input.expectedSelection).toEqual(
      saved.shots.map((shot) => ({ shotId: shot.id, takeId: shot.selectedTakeId })),
    );
    return {
      kind: partial ? "PARTIAL" : "ASSEMBLED",
      projectId: input.projectId,
      projectHash: input.expectedHash,
      path: "/tmp/pipeline-final.mp4",
      durationSeconds: count * 3,
      shots: input.expectedSelection.map((row, i) => ({
        ...row,
        startSeconds: i * 3,
        durationSeconds: 3,
      })),
      limitations: [],
      ...(partial ? { incomplete: "audio" as const } : {}),
    };
  });
  const prepare = vi.fn<FilmGenerationExecutionGateway["prepareFilmGenerationExecution"]>(
    async (input) => {
      expect(input.projectId).toBe(saved.id);
      expect(input.mode).toBe("pipeline");
      expect(input.expectedProjectHash).toBe(await historyRecordHash(saved));
      expect(input.targets).toEqual(saved.shots.map((shot) => ({ shotId: shot.id, versions: 1 })));
      expect(history.at(-1)?.entry.reason).toBe("before-pipeline");
      expect(video).not.toHaveBeenCalled();
      return {
        kind: "PREPARED",
        executionId: "native-pipeline",
        projectId: input.projectId,
        projectHash: input.expectedProjectHash,
        targets: input.targets.map((target) => ({
          shotId: target.shotId,
          preparation: "CLIENT_IMAGES" as const,
          videoSlotIds: [`slot-${target.shotId}`],
          slotPreparations: [`slot-${target.shotId}`].map((videoSlotId) => ({
            videoSlotId,
            preparation: "CLIENT_IMAGES" as const,
          })),
        })),
        stages: [
          ...sceneLocationTargets(saved).map((place) => ({
            kind: "location-reference" as const,
            stageId: `location-${place.id}`,
            targetId: place.id,
          })),
          ...saved.shots.map((shot) => ({
            kind: "shot-frame" as const,
            stageId: `frame-${shot.id}`,
            targetId: shot.id,
          })),
        ],
      };
    },
  );
  const retire = vi.fn<FilmGenerationExecutionGateway["retireFilmGenerationExecution"]>(
    async () => ({ kind: "RETIRED" }),
  );
  window.aijian = {
    prepareFilmGenerationExecution: prepare,
    retireFilmGenerationExecution: retire,
    prepareFilmProject: vi.fn(async (value: FilmProject) => structuredClone(value)),
    writeFilmProject: vi.fn(async (value: FilmProject) => {
      saved = structuredClone(value as FilmProject);
      return structuredClone(saved);
    }),
    readFilmProject: vi.fn(async (id: string) => (id === saved.id ? structuredClone(saved) : null)),
    captureFilmHistory: vi.fn(
      async (input: {
        projectId: string;
        expectedHash: string;
        reason: Exclude<FilmHistoryReason, "before-restore">;
      }) => {
        if (input.projectId !== saved.id || input.expectedHash !== (await historyRecordHash(saved)))
          return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
        const entry: FilmHistoryEntry = {
          id: `hst_${String(history.length + 1).padStart(32, "0")}`,
          createdAt: new Date().toISOString(),
          reason: input.reason,
          summary: {
            scenes: saved.scenes.length,
            shots: saved.shots.length,
            done: saved.shots.filter((shot) => shot.takes.some((take) => take.status === "done"))
              .length,
          },
        };
        history.push({ entry, snapshot: structuredClone(saved) });
        order.push(`capture:${input.reason}`);
        return { kind: "CAPTURED", entry: structuredClone(entry) };
      },
    ),
    listFilmHistory: vi.fn(async (id: string) =>
      id === saved.id
        ? { kind: "LIST", entries: history.map((row) => structuredClone(row.entry)), unreadable: 0 }
        : { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true },
    ),
    restoreFilmHistory: vi.fn(async () => {
      throw new Error("Restore is not part of pipeline dispatch");
    }),
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => []),
    generateFilmStill: vi.fn(async (...args: unknown[]) => {
      expect(args[4]).toMatchObject({ executionId: "native-pipeline" });
      expect(prepare.mock.results[0]?.type).toBe("return");
      return { path: "/tmp/pipeline-image.png", reason: "" };
    }),
    createStoryFilm: video,
    assembleFilm: legacyAssemble,
    assembleFilmProject: assemble,
    cancelFilmAssemblyOperation: vi.fn(),
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  return {
    film,
    prepare,
    completeText,
    video,
    assemble,
    legacyAssemble,
    history,
    order,
    saved: () => structuredClone(saved),
  };
}
async function confirmFirstMedia(f: ReturnType<typeof fixture>) {
  const progress = await screen.findByRole("region", { name: "一键成片进度" });
  await waitFor(() =>
    expect(within(progress).getByRole("button", { name: "继续生成" })).toBeEnabled(),
  );
  expect(f.saved().productionPipeline).toMatchObject({
    status: "checkpoint",
    current: "portraits",
    continued: false,
  });
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.video).not.toHaveBeenCalled();
  expect(window.aijian!.generateFilmStill).not.toHaveBeenCalled();
  expect(progress.textContent).toContain(`视频最多 ${f.saved().shots.length} 次生成`);
  fireEvent.click(within(progress).getByRole("button", { name: "继续生成" }));
}
it("runs the real host to human review and a persisted checkpoint before any video", async () => {
  const f = fixture();
  render(<ProWorkspace projectId={projectId} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  fireEvent.click(await screen.findByRole("button", { name: "一键成片" }));
  await confirmFirstMedia(f);
  await waitFor(
    () =>
      expect(
        `${f.saved().productionPipeline?.status}/${f.saved().productionPipeline?.current}/${f.completeText.mock.calls.length}`,
        JSON.stringify(f.saved().productionPipeline),
      ).toBe("needs-input/review/5"),
    { timeout: 5000 },
  );
  expect(f.video).not.toHaveBeenCalled();
  expect(f.history[0]?.entry.reason).toBe("before-pipeline");
  expect(f.history[0]?.snapshot.sourceText).toBe(f.film.sourceText);
  expect(f.history[0]?.snapshot.shots).toEqual([]);
  expect(f.order.indexOf("capture:before-pipeline")).toBeLessThan(f.order.indexOf("member:text"));
  const progress = screen.getByRole("region", { name: "一键成片进度" });
  fireEvent.click(within(progress).getByRole("button", { name: /要处理的/ }));
  fireEvent.change(within(progress).getByRole("textbox"), {
    target: { value: "已检查每张场景画面" },
  });
  fireEvent.click(within(progress).getByRole("button", { name: "记下审片结论" }));
  await waitFor(() => expect(f.saved().productionPipeline?.status).toBe("checkpoint"));
  expect(f.saved().productionPipeline?.checkpoint?.coverage.every((scene) => scene.ok)).toBe(true);
  expect(f.video).not.toHaveBeenCalled();
  fireEvent.click(within(progress).getByRole("button", { name: "继续生成" }));
  await waitFor(() => expect(f.video).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "开始生成" })).not.toBeInTheDocument();
  await waitFor(() => expect(f.saved().productionPipeline?.status).toBe("accepted"));
  expect(f.saved().productionPipeline?.steps.find((step) => step.id === "review")?.status).toBe(
    "accepted",
  );
  expect(
    f
      .saved()
      .productionPipeline?.steps.filter((step) => step.id !== "review")
      .every((step) => step.status === "done"),
  ).toBe(true);
  expect(f.assemble).toHaveBeenCalledOnce();
  expect(f.legacyAssemble).not.toHaveBeenCalled();
  expect(f.saved().assemblyPath).toBe("/tmp/pipeline-final.mp4");
  const batchCapture = f.order.indexOf("capture:before-batch-generation");
  expect(batchCapture).toBeGreaterThanOrEqual(0);
  expect(batchCapture).toBeLessThan(f.order.indexOf("member:video"));
  expect(
    f.history.find((row) => row.entry.reason === "before-batch-generation")?.snapshot.shots,
  ).toHaveLength(1);
  expect(f.saved().shots[0]!.takes[0]!.status).toBe("done");
});

it.each([false, true])(
  "does not automatically repeat a pipeline-produced complete or partial two-shot assembly on entering edit (partial=%s)",
  async (partial) => {
    const f = fixture(partial, 2);
    render(<ProWorkspace projectId={projectId} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
        "title",
        "Grok 会员 · 已连接",
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "一键成片" }));
    await confirmFirstMedia(f);
    await waitFor(() =>
      expect(
        `${f.saved().productionPipeline?.status}/${f.saved().productionPipeline?.current}`,
        JSON.stringify(
          f.saved().productionPipeline?.steps.map((s) => ({
            id: s.id,
            status: s.status,
            targets: s.targets.map((t) => ({ code: t.code, status: t.status })),
          })),
        ),
      ).toBe("needs-input/review"),
    );
    expect(f.saved().shots).toHaveLength(2);
    const progress = screen.getByRole("region", { name: "一键成片进度" });
    fireEvent.click(within(progress).getByRole("button", { name: /要处理的/ }));
    fireEvent.change(within(progress).getByRole("textbox"), {
      target: { value: "已检查两张场景画面" },
    });
    fireEvent.click(within(progress).getByRole("button", { name: "记下审片结论" }));
    await waitFor(() => expect(f.saved().productionPipeline?.status).toBe("checkpoint"));
    fireEvent.click(within(progress).getByRole("button", { name: "继续生成" }));
    await waitFor(() =>
      expect(
        f.saved().productionPipeline?.status,
        JSON.stringify({
          steps: f.saved().productionPipeline?.steps.map((s) => ({
            id: s.id,
            status: s.status,
            targets: s.targets.map((t) => ({ status: t.status, code: t.code })),
          })),
          video: f.video.mock.calls.length,
          assembly: f.assemble.mock.calls.length,
        }),
      ).toBe(partial ? "needs-input" : "accepted"),
    );
    expect(f.saved().assemblyPath).toBe("/tmp/pipeline-final.mp4");
    expect(f.assemble).toHaveBeenCalledOnce();
    expect(f.video).toHaveBeenCalledTimes(2);
    if (partial)
      expect(f.saved().productionPipeline?.steps.find((s) => s.id === "assembly")?.status).toBe(
        "needs-input",
      );
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
        name: /剪辑/,
      }),
    );
    await screen.findByText("时间线展示镜头计划，播放器按实际粗剪时钟计时。");
    // An ordinary metadata save is allowed; the verified assembly must still satisfy auto admission.
    await waitFor(() => expect(f.saved().assemblyPath).toBe("/tmp/pipeline-final.mp4"));
    expect(f.assemble).toHaveBeenCalledOnce();
    expect(f.video).toHaveBeenCalledTimes(2);
    expect(f.legacyAssemble).not.toHaveBeenCalled();
  },
);
