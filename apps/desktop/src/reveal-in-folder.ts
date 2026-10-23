import { spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";

const LINUX_FILE_MANAGERS = ["nautilus", "dolphin", "nemo", "thunar"] as const;

export function revealInFolder(
  filePath: string,
  options: {
    platform: NodeJS.Platform;
    showItemInFolder: (path: string) => void;
    spawn?: (command: string, args: string[]) => void;
    lookup?: (command: string) => boolean;
  },
): void {
  if (options.platform !== "linux") {
    options.showItemInFolder(filePath);
    return;
  }
  const lookup = options.lookup ?? commandExists;
  const launch = options.spawn ?? launchDetached;
  for (const name of LINUX_FILE_MANAGERS) {
    if (lookup(name)) {
      launch(name, ["--select", filePath]);
      return;
    }
  }
  launch("xdg-open", [dirname(filePath)]);
}

function commandExists(command: string): boolean {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function launchDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}
