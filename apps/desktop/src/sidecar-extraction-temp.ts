import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

// Leave room below legacy MAX_PATH for _MEIxxxxxx and files inside the bundle.
// A packaged Electron/sidecar QA run must still verify the actual archive closure.
const MAX_PARENT_LENGTH = 100;

export interface SidecarExtractionTemp {
  directory: string;
  cleanupAfterClose(): void;
}

function localDirectory(value: string | undefined): string {
  if (
    !value ||
    !isAbsolute(value) ||
    value.startsWith("\\\\") ||
    value.split(/[\\/]+/).includes("..")
  ) {
    throw new Error("Sidecar extraction requires a local absolute user directory");
  }
  return resolve(value);
}

function plainDirectory(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync.native(path).toLowerCase() !== resolve(path).toLowerCase()
  ) {
    throw new Error("Sidecar extraction directory is not plain");
  }
}

function ensurePlainDirectory(path: string): void {
  const root = parse(path).root;
  plainDirectory(root);
  const segments: string[] = [];
  for (let cursor = path; cursor !== root; cursor = dirname(cursor)) {
    segments.push(cursor);
  }
  for (const segment of segments.reverse()) {
    try {
      plainDirectory(segment);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mkdirSync(segment, { mode: 0o700 });
      plainDirectory(segment);
    }
  }
}

export function createSidecarExtractionTemp(
  localAppData: string | undefined,
  userProfile: string | undefined,
): SidecarExtractionTemp {
  const local = localDirectory(localAppData);
  const profile = localDirectory(userProfile);
  if (!local.toLowerCase().startsWith(`${profile.toLowerCase()}${sep}`)) {
    throw new Error("Sidecar extraction directory is outside the user profile");
  }
  const parent = join(local, "AIVORA", "sidecar-temp");
  if (parent.length + sep.length + "x-XXXXXX".length > MAX_PARENT_LENGTH) {
    throw new Error("Sidecar extraction directory exceeds the path budget");
  }
  ensurePlainDirectory(parent);
  const directory = mkdtempSync(join(parent, "x-"));
  const probe = join(directory, "probe");
  try {
    plainDirectory(directory);
    writeFileSync(probe, "ok", { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (readFileSync(probe, "utf8") !== "ok") {
      throw new Error("Sidecar extraction directory is not writable");
    }
    unlinkSync(probe);
  } catch (error) {
    try {
      unlinkSync(probe);
    } catch {
      /* The probe may not exist. */
    }
    try {
      rmdirSync(directory);
    } catch {
      /* Preserve unexpected content. */
    }
    throw error;
  }
  return {
    directory,
    cleanupAfterClose(): void {
      // PyInstaller owns _MEI cleanup. Only remove our empty, unique wrapper;
      // never sweep another instance's files or a surviving child's extraction.
      try {
        rmdirSync(directory);
      } catch {
        /* Leave evidence for diagnosis. */
      }
    },
  };
}
