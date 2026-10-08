import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeDesktopProviderRunState(writePath, state) {
  await mkdir(dirname(writePath), { recursive: true });
  const record = { ...state, updatedAt: new Date().toISOString() };
  const temporaryPath = `${writePath}.${state.runId}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporaryPath, writePath);
  return record;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runDesktopProviderResult({
  writePath,
  runId,
  body,
  cleanup,
  writeState = writeDesktopProviderRunState,
}) {
  await writeState(writePath, { runId, stage: "RUNNING", passed: false });
  let evidence;
  let primaryFailure;
  let cleanupFailure;
  try {
    evidence = await body();
  } catch (error) {
    primaryFailure = error;
  }
  try {
    await cleanup();
  } catch (error) {
    cleanupFailure = error;
  }
  if (primaryFailure || cleanupFailure) {
    const failed = await writeState(writePath, {
      runId,
      stage: "FAILED",
      passed: false,
      failureStage: primaryFailure ? "BODY" : "CLEANUP",
      primaryError: primaryFailure ? errorMessage(primaryFailure) : undefined,
      cleanupError: cleanupFailure ? errorMessage(cleanupFailure) : undefined,
    });
    const failure = primaryFailure ?? cleanupFailure;
    failure.result = failed;
    throw failure;
  }
  if (!evidence) throw new Error("Desktop provider body completed without evidence");
  return writeState(writePath, { ...evidence, runId, stage: "PASSED", passed: true });
}
