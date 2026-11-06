import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { trustedMediaPath } from "./film-library";
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof fs>();
  const walker = vi.fn(actual.realpathSync);
  Object.assign(walker, { native: actual.realpathSync.native });
  return { ...actual, realpathSync: walker };
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("admits the same real media through a DOS-style alias when async roots use native long names", async () => {
  const temp = await mkdtemp(join(tmpdir(), "media-native-"));
  roots.push(temp);
  const directory = join(temp, "真实 中文工具目录 long name"),
    alias = join(temp, "DOSALI~1");
  await mkdir(directory);
  const source = join(directory, "片段 有空格.mp4");
  await writeFile(source, "unique real fixture bytes");
  await symlink(directory, alias, process.platform === "win32" ? "junction" : "dir");
  const actual = await vi.importActual<typeof fs>("node:fs");
  const native = actual.realpathSync.native,
    legacy = actual.realpathSync;
  // Windows' JS walker can preserve an 8.3 component while libuv native resolves it.
  // The filesystem/junction is real; only that documented representation split is emulated.
  const walker = vi
    .mocked(fs.realpathSync)
    .mockImplementation((path, options) =>
      typeof path === "string" && (path === alias || path.startsWith(alias + sep))
        ? path
        : legacy(path, options),
    );
  Object.assign(walker, { native: vi.fn(native) });
  const path = trustedMediaPath([await realpath(directory)], join(alias, "片段 有空格.mp4"));
  const actualStat = fs.statSync(path, { bigint: true }),
    expected = fs.statSync(source, { bigint: true });
  expect({ dev: actualStat.dev, ino: actualStat.ino }).toEqual({
    dev: expected.dev,
    ino: expected.ino,
  });
  expect(fs.readFileSync(path)).toEqual(fs.readFileSync(source));
});

it("keeps native CJK alias boundaries strict for junction escapes and explicit traversal", async () => {
  const temp = await mkdtemp(join(tmpdir(), "media-native-escape-"));
  roots.push(temp);
  const directory = join(temp, "作品 中文"),
    foreign = join(temp, "other"),
    alias = join(temp, "DOSALI~1");
  await Promise.all([mkdir(directory), mkdir(foreign)]);
  await writeFile(join(foreign, "foreign.mp4"), "foreign bytes");
  await symlink(directory, alias, process.platform === "win32" ? "junction" : "dir");
  await symlink(
    foreign,
    join(directory, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const actual = await vi.importActual<typeof fs>("node:fs");
  const native = actual.realpathSync.native,
    legacy = actual.realpathSync;
  const walker = vi
    .mocked(fs.realpathSync)
    .mockImplementation((path, options) =>
      typeof path === "string" && (path === alias || path.startsWith(alias + sep))
        ? path
        : legacy(path, options),
    );
  Object.assign(walker, { native: vi.fn(native) });
  const root = await realpath(directory);
  expect(() => trustedMediaPath([root], join(alias, "escape", "foreign.mp4"))).toThrow(
    "Invalid film path",
  );
  expect(() => trustedMediaPath([root], `${alias}${sep}..${sep}other${sep}foreign.mp4`)).toThrow(
    "Invalid film path",
  );
});
