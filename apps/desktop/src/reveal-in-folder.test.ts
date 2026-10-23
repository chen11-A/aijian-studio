import { describe, expect, it, vi } from "vitest";
import { revealInFolder } from "./reveal-in-folder";

describe("reveal in the platform file manager", () => {
  it("uses showItemInFolder on Windows and macOS", () => {
    for (const platform of ["win32", "darwin"] as const) {
      const showItemInFolder = vi.fn();
      const spawn = vi.fn();
      revealInFolder("/films/story.mp4", { platform, showItemInFolder, spawn });
      expect(showItemInFolder).toHaveBeenCalledExactlyOnceWith("/films/story.mp4");
      expect(spawn).not.toHaveBeenCalled();
    }
  });

  it("selects the file in a Linux file manager", () => {
    const showItemInFolder = vi.fn();
    const spawn = vi.fn();
    revealInFolder("/home/me/story-films/story.mp4", {
      platform: "linux",
      showItemInFolder,
      spawn,
      lookup: (command) => command === "nautilus",
    });
    expect(showItemInFolder).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledExactlyOnceWith("nautilus", [
      "--select",
      "/home/me/story-films/story.mp4",
    ]);
  });

  it("opens the containing folder with xdg-open when no file manager is installed", () => {
    const showItemInFolder = vi.fn();
    const spawn = vi.fn();
    revealInFolder("/home/me/story-films/story.mp4", {
      platform: "linux",
      showItemInFolder,
      spawn,
      lookup: () => false,
    });
    expect(showItemInFolder).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledExactlyOnceWith("xdg-open", ["/home/me/story-films"]);
  });
});
