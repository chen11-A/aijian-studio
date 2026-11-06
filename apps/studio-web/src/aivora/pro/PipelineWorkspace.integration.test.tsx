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
function fixture() {
  const film = blankFilm();
  film.title = "流水线回归";
  film.seriesTitle = film.title;
  film.sourceText = "雨停了。";
  film.scenes[0]!.text = film.sourceText;
  film.scenes[0]!.where = "巷口 · 夜";
  film.characters = [];
  film.locations = [];
  film.shots = [];
  let saved: FilmProject = film;
  const completeText = vi.fn(async ({ text }: { text: string }) => {
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
        shots: [{ picture: film.sourceText, size: "全景", seconds: 3, characters: [], lines: [] }],
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
  const video = vi.fn(async () => ({
    data: {
      status: "SUCCEEDED",
      output_path: "/tmp/pipeline-video.mp4",
      duration_seconds: 3,
      message: "",
    },
  }));
  const assemble = vi.fn(async () => ({ path: "/tmp/pipeline-final.mp4", reason: "" }));
  window.aijian = {
    prepareFilmProject: vi.fn(async (value: FilmProject) => structuredClone(value)),
    writeFilmProject: vi.fn(async (value: FilmProject) => {
      saved = structuredClone(value as FilmProject);
      return value;
    }),
    readFilmProject: vi.fn(async () => saved),
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => []),
    generateFilmStill: vi.fn(async () => ({ path: "/tmp/pipeline-image.png", reason: "" })),
    createStoryFilm: video,
    assembleFilm: assemble,
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  return { film, completeText, video, assemble, saved: () => saved };
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
  await waitFor(
    () =>
      expect(
        `${f.saved().productionPipeline?.status}/${f.saved().productionPipeline?.current}/${f.completeText.mock.calls.length}`,
        JSON.stringify(f.saved().productionPipeline),
      ).toBe("needs-input/review/5"),
    { timeout: 5000 },
  );
  expect(f.video).not.toHaveBeenCalled();
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
  expect(f.saved().shots[0]!.takes[0]!.status).toBe("done");
});
