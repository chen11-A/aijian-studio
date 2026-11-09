import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { FixedInputImportButton } from "./FixedInputImportButton";

afterEach(() => {
  cleanup();
  delete window.aijian;
});

function setup() {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  const onFilm = vi.fn();
  const onNotice = vi.fn();
  return { film, shot, onFilm, onNotice };
}

it("imports through the explicit project id and assigns only the main-returned file", async () => {
  const { film, shot, onFilm, onNotice } = setup();
  const importFixedInput = vi.fn(async (projectId: string) => {
    expect(projectId).toBe(film.id);
    return { ok: true as const, path: "/films/series/stills/picked.png" };
  });
  window.aijian = { importFixedInput } as unknown as Window["aijian"];
  render(<FixedInputImportButton film={film} shot={shot} onFilm={onFilm} onNotice={onNotice} />);
  fireEvent.click(screen.getByRole("button", { name: "导入为固定输入" }));
  await vi.waitFor(() => expect(onFilm).toHaveBeenCalledTimes(1));
  expect(importFixedInput).toHaveBeenCalledTimes(1);
  expect(importFixedInput.mock.calls[0]).toEqual([film.id]);
  expect(onFilm).toHaveBeenCalledTimes(1);
  expect(onFilm.mock.calls[0]?.[0].shots[0].poster).toContain("picked.png");
  expect(onNotice).toHaveBeenCalledWith(
    "已导入这张画面为固定输入。随后的视频准备仍会核对当前文件。",
  );
  expect(screen.queryByRole("button", { name: "确认这张手工画面为固定输入" })).toBeNull();
});

it("does not change the shot when import is cancelled or refused", async () => {
  const { film, shot, onFilm, onNotice } = setup();
  const importFixedInput = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, code: "CANCELLED" })
    .mockResolvedValueOnce({ ok: false, code: "UNSUPPORTED_SCOPE" });
  window.aijian = { importFixedInput } as unknown as Window["aijian"];
  render(<FixedInputImportButton film={film} shot={shot} onFilm={onFilm} onNotice={onNotice} />);
  fireEvent.click(screen.getByRole("button", { name: "导入为固定输入" }));
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("已取消导入固定输入。"));
  fireEvent.click(screen.getByRole("button", { name: "导入为固定输入" }));
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("这张图不能当作固定输入。"));
  expect(onFilm).not.toHaveBeenCalled();
});

it("confirms a main-issued offer without sending path, origin, metadata or cacheHit", async () => {
  const { film, shot, onFilm, onNotice } = setup();
  const offerId = "fio_01234567-89ab-cdef-0123-456789abcdef";
  const confirmFixedInput = vi.fn(async (...args: unknown[]) => {
    expect(args).toEqual([film.id, offerId]);
    return { ok: true as const, path: "/films/series/stills/manual.png" };
  });
  window.aijian = { confirmFixedInput } as unknown as Window["aijian"];
  render(
    <FixedInputImportButton
      film={film}
      shot={shot}
      offerId={offerId}
      onFilm={onFilm}
      onNotice={onNotice}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认这张手工画面为固定输入" }));
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("已确认这张手工画面为固定输入。"));
  expect(confirmFixedInput).toHaveBeenCalledTimes(1);
  expect(onFilm).not.toHaveBeenCalled();
});
