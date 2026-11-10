import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { createFilmPersistence } from "../film-persistence";
import { importShotFixedInput } from "./fixed-input-actions";

afterEach(() => {
  delete window.aijian;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps a newer draft on the real save queue when import returns after an edit, switch, delete, or cancel", async () => {
  const original = sampleFilm();
  original.shots[0]!.picture = "旧稿";
  const edited = structuredClone(original);
  edited.shots[0]!.picture = "新稿不能被覆盖";
  let current: FilmProject | null = original;
  const writes: FilmProject[] = [];
  const persistence = createFilmPersistence({
    current: () => current,
    write: async (film) => {
      writes.push(structuredClone(film));
      return structuredClone(film);
    },
  });
  const dialog = deferred<
    { ok: true; path: string } | { ok: false; code: "CANCELLED" | "LEDGER_FULL" }
  >();
  window.aijian = {
    importFixedInput: vi.fn(() => dialog.promise),
  } as unknown as Window["aijian"];
  const notices: string[] = [];
  const pending = importShotFixedInput(original, original.shots[0]!, {
    current: () => current,
    apply: (next) => {
      current = next;
    },
    onNotice: (text) => notices.push(text),
  });
  current = edited;
  dialog.resolve({ ok: true, path: "/films/series/stills/picked.png" });
  await pending;
  expect(current?.shots[0]?.picture).toBe("新稿不能被覆盖");
  expect(current?.shots[0]?.poster).toContain("picked.png");
  const stored = await persistence.save(current!);
  expect(stored?.shots[0]?.picture).toBe("新稿不能被覆盖");
  expect(stored?.shots[0]?.poster).toContain("picked.png");
  expect(writes.some((film) => film.shots[0]?.picture === "旧稿")).toBe(false);

  const stale = await persistence.save(original);
  expect(stale).toBeNull();
  expect(writes.every((film) => film.shots[0]?.picture !== "旧稿")).toBe(true);

  const switched = sampleFilm();
  switched.id = "film_other000000000001";
  switched.title = "另一部作品";
  current = switched;
  const otherDialog = deferred<{ ok: true; path: string }>();
  vi.mocked(window.aijian!.importFixedInput!).mockImplementationOnce(() => otherDialog.promise);
  const switchImport = importShotFixedInput(original, original.shots[0]!, {
    current: () => current,
    apply: (next) => {
      current = next;
    },
    onNotice: (text) => notices.push(text),
  });
  otherDialog.resolve({ ok: true, path: "/films/series/stills/other.png" });
  await switchImport;
  expect(current).toBe(switched);
  expect(current.title).toBe("另一部作品");
  expect(await persistence.save(original)).toBeNull();

  const removed = structuredClone(edited);
  removed.shots = [];
  current = removed;
  const deleteDialog = deferred<{ ok: true; path: string }>();
  vi.mocked(window.aijian!.importFixedInput!).mockImplementationOnce(() => deleteDialog.promise);
  const deleteImport = importShotFixedInput(original, original.shots[0]!, {
    current: () => current,
    apply: (next) => {
      current = next;
    },
    onNotice: (text) => notices.push(text),
  });
  deleteDialog.resolve({ ok: true, path: "/films/series/stills/deleted.png" });
  await deleteImport;
  expect(current).toBe(removed);
  expect(current.shots).toEqual([]);

  current = edited;
  const cancelDialog = deferred<{ ok: false; code: "CANCELLED" }>();
  vi.mocked(window.aijian!.importFixedInput!).mockImplementationOnce(() => cancelDialog.promise);
  const beforeCancel = writes.length;
  const cancelImport = importShotFixedInput(original, original.shots[0]!, {
    current: () => current,
    apply: (next) => {
      current = next;
    },
    onNotice: (text) => notices.push(text),
  });
  cancelDialog.resolve({ ok: false, code: "CANCELLED" });
  await cancelImport;
  expect(current).toBe(edited);
  expect(writes).toHaveLength(beforeCancel);
  expect(notices).toContain("已取消导入固定输入。");
  expect(notices).toContain("当前作品或镜头已经变化，没有把这张图写进旧稿。");
});
