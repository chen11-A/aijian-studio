import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { removeFilm, listFilms, readSaved } from "../film/library";
import { deleteCurrentFilm } from "./delete-workflow";
vi.mock("../film/library", () => ({ removeFilm: vi.fn(), listFilms: vi.fn(), readSaved: vi.fn() }));
it("does not change current selection or close another project's dialog after a late deletion", async () => {
  let resolve!: () => void;
  let valid = true;
  vi.mocked(removeFilm).mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const apply = vi.fn(),
    close = vi.fn(),
    notice = vi.fn();
  const pending = deleteCurrentFilm(sampleFilm(), false, {
    valid: () => valid,
    apply,
    close,
    notice,
  });
  valid = false;
  resolve();
  await pending;
  expect(listFilms).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(notice).not.toHaveBeenCalled();
});

it("closes a deleted series and clears its selection", async () => {
  vi.mocked(removeFilm).mockResolvedValueOnce();
  const apply = vi.fn(),
    close = vi.fn(),
    notice = vi.fn();
  await deleteCurrentFilm(sampleFilm(), true, { valid: () => true, apply, close, notice });
  expect(apply).toHaveBeenCalledWith(null);
  expect(close).toHaveBeenCalledOnce();
  expect(notice).toHaveBeenCalledWith("已删除这部作品。");
});
it("selects the remaining episode after deletion and reports rejection without changing it", async () => {
  const base = sampleFilm(),
    apply = vi.fn(),
    close = vi.fn(),
    notice = vi.fn();
  vi.mocked(removeFilm).mockResolvedValueOnce();
  vi.mocked(listFilms).mockResolvedValueOnce([{ id: "next" }] as Awaited<
    ReturnType<typeof listFilms>
  >);
  vi.mocked(readSaved).mockResolvedValueOnce({ ...base, id: "next" });
  const host = { valid: () => true, apply, close, notice };
  await deleteCurrentFilm(base, false, host);
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: "next" }));
  apply.mockClear();
  vi.mocked(removeFilm).mockRejectedValueOnce(new Error("disk failure"));
  await deleteCurrentFilm(base, false, host);
  expect(apply).not.toHaveBeenCalled();
  expect(notice).toHaveBeenLastCalledWith("删除没有完成，请重试。");
});
