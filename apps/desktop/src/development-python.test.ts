import { lstatSync, readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { developmentPythonLaunch } from "./development-python";

vi.mock("node:fs", () => ({ lstatSync: vi.fn(), readFileSync: vi.fn() }));
const root = "C:\\source\\aivora";
const base = "C:\\Program Files\\Python312";
const regularFile = { isFile: () => true, isSymbolicLink: () => false, size: 200 };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lstatSync).mockReturnValue(regularFile as ReturnType<typeof lstatSync>);
  vi.mocked(readFileSync).mockReturnValue(
    `home = ${base}\r\ninclude-system-site-packages = false\r\n`,
  );
});

test("directly owns the base interpreter while preserving the Windows venv", () => {
  expect(developmentPythonLaunch(root, "win32")).toEqual({
    command: `${base}\\python.exe`,
    env: { __PYVENV_LAUNCHER__: `${root}\\.venv\\Scripts\\python.exe` },
  });
  expect(readFileSync).toHaveBeenCalledWith(`${root}\\.venv\\pyvenv.cfg`, "utf8");
});

test("keeps POSIX launch behavior without reading Windows metadata", () => {
  expect(developmentPythonLaunch("/source/aivora", "linux")).toEqual({
    command: "/source/aivora/.venv/bin/python",
    env: {},
  });
  expect(lstatSync).not.toHaveBeenCalled();
  expect(readFileSync).not.toHaveBeenCalled();
});

test.each([
  "",
  "home = relative/path",
  "home = C:relative",
  "home = \\\\server\\share",
  "home = C:\\Python\\..\\other",
  "home = C:\\Python\0",
  `home = ${base}\nhome = C:\\other`,
  `home = ${root}\\.venv\\Scripts`,
])("fails closed on invalid or ambiguous interpreter metadata %j", (config) => {
  vi.mocked(readFileSync).mockReturnValue(config);
  expect(() => developmentPythonLaunch(root, "win32")).toThrow();
});

test.each([
  { ...regularFile, size: 65_537 },
  { ...regularFile, isFile: () => false },
  { ...regularFile, isSymbolicLink: () => true },
])("rejects non-plain or oversized metadata before reading it", (info) => {
  vi.mocked(lstatSync).mockReturnValue(info as ReturnType<typeof lstatSync>);
  expect(() => developmentPythonLaunch(root, "win32")).toThrow();
  expect(readFileSync).not.toHaveBeenCalled();
});

test("rejects a linked interpreter rather than following another launcher", () => {
  vi.mocked(lstatSync).mockReturnValueOnce(regularFile as ReturnType<typeof lstatSync>);
  vi.mocked(lstatSync).mockReturnValue({
    ...regularFile,
    isSymbolicLink: () => true,
  } as ReturnType<typeof lstatSync>);
  expect(() => developmentPythonLaunch(root, "win32")).toThrow();
});
