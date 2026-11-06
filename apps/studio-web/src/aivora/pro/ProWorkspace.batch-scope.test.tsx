import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";

const PROJECT_ID = `prj_${"a".repeat(32)}`;
const success = { data: { status: "SUCCEEDED", output_path: "/tmp/batch-new.mp4" } };

function fixture() {
  const film = sampleFilm();
  film.backendProjectId = PROJECT_ID;
  film.shots = film.shots.slice(0, 4).map((shot, index) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    no: index + 1,
    seconds: 3,
    line: "",
    lines: [],
    speaker: "",
    characters: [],
    poster: `/tmp/original-${index}.png`,
    selectedTakeId: `old-${index}`,
    takes: [
      {
        id: `old-${index}`,
        shotId: shot.id,
        index: 1,
        status: "done" as const,
        videoPath: `/tmp/original-${index}.mp4`,
        videoUrl: `aivora-media://local/?path=%2Ftmp%2Foriginal-${index}.mp4`,
        stillUrl: `/tmp/original-${index}.png`,
        prompt: "old prompt",
        createdAt: "",
        reason: "",
      },
    ],
  }));
  return film;
}

function desktop(film: FilmProject, video = vi.fn(async () => success)) {
  const other = structuredClone(film);
  other.id = "film_batchscopeother001";
  other.title = "另一个作品";
  other.episodeTitle = "第 2 集";
  const write = vi.fn(async (next: FilmProject) => structuredClone(next));
  window.aijian = {
    createStoryFilm: video,
    prepareFilmProject: vi.fn(async (next: FilmProject) => structuredClone(next)),
    generateFilmStill: vi.fn(async () => ({ path: "/tmp/still.png", reason: "" })),
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => [
      {
        id: other.id,
        seriesId: film.seriesId,
        title: "第 2 集",
        no: 2,
        shots: 4,
        done: 4,
        savedAt: "",
      },
    ]),
    readFilmProject: vi.fn(async (id: string) => structuredClone(id === other.id ? other : film)),
    writeFilmProject: write,
  } as unknown as Window["aijian"];
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    })),
    models: vi.fn(async () => ({
      kind: "OK",
      models: [
        { id: "grok-imagine-video-1.5", label: "video" },
        { id: "grok-imagine-image-2.0", label: "image" },
      ],
    })),
  } as unknown as Window["aijianGrok"];
  window.localStorage.setItem("aivora.film.activeId", film.id);
  const latest = () => write.mock.calls.at(-1)?.[0];
  return { write, latest, video, other };
}

async function open(withProject = true) {
  render(<ProWorkspace projectId={withProject ? PROJECT_ID : undefined} />);
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: "分镜",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  await waitFor(() => expect(document.querySelectorAll(".grid .card")).toHaveLength(4));
}
function pick() {
  const cards = document.querySelectorAll(".grid .card");
  fireEvent.click(cards[1]!);
  fireEvent.click(cards[3]!, { ctrlKey: true });
  expect(screen.getByText(/选了 2 个镜头/)).toBeInTheDocument();
}
function queue() {
  fireEvent.click(screen.getByRole("button", { name: /^(重新)?生成这 2 个$/ }));
  const table = screen.getByRole("dialog", { name: "生成前确认" });
  expect(
    within(table)
      .getAllByRole("row")
      .map((row) => row.querySelector("th,td")?.textContent),
  ).toEqual(["镜头", "第 1 场第 2 个镜头", "第 1 场第 4 个镜头"]);
  expect(within(table).getByRole("columnheader", { name: "台词的声音" })).toBeInTheDocument();
  expect(within(table).getAllByText("没有台词")).toHaveLength(2);
  return within(table).getByRole("button", { name: "开始生成" });
}
function deferredVideo() {
  let release!: (value: typeof success) => void;
  const video = vi
    .fn(async () => success)
    .mockImplementationOnce(
      () =>
        new Promise<typeof success>((resolve) => {
          release = resolve;
        }),
    );
  return {
    video,
    finish: async () => {
      await act(async () => {
        release(success);
      });
    },
  };
}

describe("5-3-06 selected batch host scope", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
    delete window.aijianGrok;
  });

  it("submits exactly the nonadjacent selected IDs and retains all existing media and versions", async () => {
    const film = fixture();
    const { video, latest } = desktop(film);
    await open();
    pick();
    fireEvent.click(queue());
    await waitFor(() =>
      expect(latest()?.shots.filter((row) => row.takes.length === 2)).toHaveLength(2),
    );
    await waitFor(() =>
      expect(
        latest()?.shots.filter((row) =>
          row.takes.some((take) => take.videoPath === success.data.output_path),
        ),
      ).toHaveLength(2),
    );
    expect(video).toHaveBeenCalledTimes(2);
    const requested = video.mock.calls.flatMap((call) =>
      (call as unknown as [string, { shots: { still: string }[] }])[1].shots.map(
        (row) => row.still,
      ),
    );
    expect(requested.sort()).toEqual([film.shots[1]!.poster, film.shots[3]!.poster].sort());
    const requestedIds = [film.shots[1]!.id, film.shots[3]!.id];
    for (const [index, row] of latest()!.shots.entries()) {
      expect(row.takes[0]).toEqual(film.shots[index]!.takes[0]);
      if ([0, 2].includes(index)) expect(row.takes).toEqual(film.shots[index]!.takes);
    }
    expect(
      latest()!
        .jobs.filter((job) => job.kind === "video")
        .map((job) => job.shotId)
        .sort(),
    ).toEqual(requestedIds.sort());
  });

  it("cancels without queueing or changing any selected or unselected version", async () => {
    const film = fixture();
    const { video, latest } = desktop(film);
    await open();
    pick();
    queue();
    fireEvent.click(screen.getByRole("button", { name: "先不生成" }));
    await waitFor(() => expect(latest()?.id).toBe(film.id));
    expect(video).not.toHaveBeenCalled();
    expect(latest()!.shots.map((row) => row.takes)).toEqual(film.shots.map((row) => row.takes));
    expect(latest()!.jobs).toEqual(film.jobs);
  });

  it("changes and undoes only selected durations while keeping existing versions", async () => {
    const film = fixture();
    const { latest, video } = desktop(film);
    await open();
    pick();
    fireEvent.click(screen.getByRole("button", { name: "都改成 10 秒" }));
    await waitFor(() => expect(latest()?.shots.map((row) => row.seconds)).toEqual([3, 10, 3, 10]));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(latest()?.shots.map((row) => row.seconds)).toEqual([3, 3, 3, 3]));
    expect(latest()!.shots.map((row) => row.takes)).toEqual(film.shots.map((row) => row.takes));
    expect(video).not.toHaveBeenCalled();
  });

  it("consumes repeated clicks once and rejects another confirmation during an active run", async () => {
    const film = fixture();
    const pending = deferredVideo();
    const { latest } = desktop(film, pending.video);
    await open();
    pick();
    const start = queue();
    await act(async () => {
      start.click();
      start.click();
    });
    await waitFor(() => expect(pending.video).toHaveBeenCalledTimes(1));
    fireEvent.click(queue());
    expect(screen.getByText("这一批还在生成，请等完成后再试。")).toBeInTheDocument();
    expect(latest()!.shots.map((row) => row.takes.length)).toEqual([1, 2, 1, 2]);
    expect(pending.video).toHaveBeenCalledTimes(1);
    await pending.finish();
  });

  it("keeps versions completed while a second confirmation table was open", async () => {
    const film = fixture();
    const pending = deferredVideo();
    const { latest } = desktop(film, pending.video);
    await open();
    pick();
    fireEvent.click(queue());
    await waitFor(() => expect(pending.video).toHaveBeenCalledTimes(1));
    const nextStart = queue();
    await pending.finish();
    await waitFor(() => expect(latest()?.shots[1]?.takes[1]?.status).toBe("done"));
    pending.video.mockResolvedValue(success);
    fireEvent.click(nextStart);
    await waitFor(() => expect(pending.video).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(latest()?.shots[1]?.takes[2]?.status).toBe("done"));
    for (const index of [1, 3]) {
      expect(latest()!.shots[index]!.takes).toHaveLength(3);
      expect(latest()!.shots[index]!.takes[1]).toMatchObject({
        status: "done",
        videoPath: success.data.output_path,
      });
    }
    for (const index of [0, 2])
      expect(latest()!.shots[index]!.takes).toEqual(film.shots[index]!.takes);
  });

  it("does not dispatch a deleted target or its neighbors after awaiting billing preparation", async () => {
    const film = fixture();
    film.backendProjectId = "";
    const { video, latest } = desktop(film);
    let release!: (value: { data: { id: string } }) => void;
    const billing = new Promise<{ data: { id: string } }>((resolve) => {
      release = resolve;
    });
    window.aijian!.createProject = vi.fn().mockReturnValue(billing);
    await open(false);
    pick();
    fireEvent.click(queue());
    await waitFor(() => expect(window.aijian!.createProject).toHaveBeenCalledTimes(1));
    fireEvent.contextMenu(document.querySelectorAll(".grid .card")[1]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除这一镜" }));
    await waitFor(() => expect(latest()?.shots).toHaveLength(3));
    await act(async () => {
      release({ data: { id: PROJECT_ID } });
    });
    expect(await screen.findByText("所选镜头已经变化，请重新选择后生成。")).toBeInTheDocument();
    expect(video).not.toHaveBeenCalled();
    expect(latest()!.shots.map((row) => row.id)).not.toContain(film.shots[1]!.id);
    expect(latest()!.shots.every((row) => row.takes.length === 1)).toBe(true);
  });

  it("clears the previous work confirmation and ignores its late generation results after switching", async () => {
    const film = fixture();
    const pending = deferredVideo();
    const { latest, other, write } = desktop(film, pending.video);
    await open();
    pick();
    fireEvent.click(queue());
    await waitFor(() => expect(pending.video).toHaveBeenCalledTimes(1));
    queue();
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
    await screen.findByText(/已打开第 2 集/);
    expect(screen.queryByRole("dialog", { name: "生成前确认" })).toBeNull();
    await pending.finish();
    await waitFor(() => expect(latest()?.id).toBe(other.id));
    const otherWrites = write.mock.calls
      .map(([value]) => value)
      .filter((value) => value.id === other.id);
    expect(otherWrites.length).toBeGreaterThan(0);
    for (const saved of otherWrites)
      expect(saved.shots.map((row) => row.takes)).toEqual(other.shots.map((row) => row.takes));
    expect(pending.video).toHaveBeenCalledTimes(1);
  });
});
