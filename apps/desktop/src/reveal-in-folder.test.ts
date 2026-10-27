import { describe, expect, it, vi } from "vitest";
import { revealInFolder } from "./reveal-in-folder";

describe("reveal in the platform file manager", () => {
  it("uses showItemInFolder on Windows, macOS, and Linux", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const showItemInFolder = vi.fn();
      const spawn = vi.fn();
      revealInFolder("/films/巷口重逢.mp4", { platform, showItemInFolder, spawn });
      expect(showItemInFolder).toHaveBeenCalledExactlyOnceWith("/films/巷口重逢.mp4");
      expect(spawn).not.toHaveBeenCalled();
    }
  });
});
