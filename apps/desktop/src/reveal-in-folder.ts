export function revealInFolder(
  filePath: string,
  options: {
    platform: NodeJS.Platform;
    showItemInFolder: (path: string) => void;
    spawn?: (command: string, args: string[]) => void;
    lookup?: (command: string) => boolean;
  },
): void {
  options.showItemInFolder(filePath);
}
