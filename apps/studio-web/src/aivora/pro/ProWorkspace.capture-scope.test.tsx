import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { saveFilm } from "../film/library";
import { capturedReplies, setCaptureEnabled } from "./agent-capture";
import { ProWorkspace } from "./ProWorkspace";

const answer = '{"shots":[{"picture":"雨中的空书店","line":"","seconds":3}]}';
async function open(pending = false) {
  const film = sampleFilm();
  film.sourceText = "用于生成归属核对的原文。";
  film.scenes = [{ ...film.scenes[0]!, text: "雨中的空书店。" }];
  film.shots = [];
  await saveFilm(film);
  let release!: (value: unknown) => void;
  const completeText = pending
    ? vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
    : vi.fn().mockResolvedValue({ kind: "OK", text: answer });
  window.aijianGrok = {
    status: vi.fn().mockResolvedValue({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    }),
    models: vi.fn().mockResolvedValue({ kind: "OK", models: [{ id: "grok-4.7", label: "text" }] }),
    completeText,
  } as unknown as Window["aijianGrok"];
  render(<ProWorkspace projectId={`prj_${"a".repeat(32)}`} />);
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
      "title",
      "Grok 会员 · 已连接",
    ),
  );
  return { film, completeText, finish: () => release({ kind: "OK", text: answer }) };
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
  setCaptureEnabled(true);
});
afterEach(() => {
  setCaptureEnabled(false);
  vi.restoreAllMocks();
});

describe("3JR-B11 manual workspace capture scope", () => {
  it("records the actual manual director request with its film identity and input hashes", async () => {
    const { film, completeText } = await open();
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    await waitFor(() => expect(capturedReplies()).toHaveLength(1));
    expect(completeText).toHaveBeenCalledTimes(1);
    expect(capturedReplies()[0]).toMatchObject({
      projectId: film.id,
      sceneId: film.scenes[0]!.id,
      reply: answer,
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      scriptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(window.localStorage.getItem("aivora.agentCapture")).not.toContain(film.sourceText);
  });

  it("keeps a late manual reply out of capture when the scene text changed during the request", async () => {
    const env = await open(true);
    fireEvent.click(screen.getByRole("button", { name: "让导演拆镜头" }));
    await waitFor(() => expect(env.completeText).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("这一场"), {
      target: { value: "已经修改的另一段剧本。" },
    });
    await act(async () => {
      env.finish();
    });
    expect(capturedReplies()).toEqual([]);
  });
});
