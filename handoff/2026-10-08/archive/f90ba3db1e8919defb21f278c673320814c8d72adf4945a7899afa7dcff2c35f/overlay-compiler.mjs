import { resolve } from "node:path";

export function createOverlayCompilerHost(ts, compilerOptions, target, candidate,
    writeFile, currentDirectory) {
  const sameTarget = (path) => resolve(path).toLowerCase() === resolve(target).toLowerCase();
  const host = ts.createCompilerHost(compilerOptions);
  if (currentDirectory) host.getCurrentDirectory = () => currentDirectory;
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.readFile = (path) => sameTarget(path) ? candidate : originalReadFile(path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    sameTarget(path) ? ts.createSourceFile(path, candidate, languageVersion, true) :
      originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  if (writeFile) host.writeFile = writeFile;
  return host;
}
