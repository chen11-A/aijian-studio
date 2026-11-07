import assert from "node:assert/strict";

/** Expected selection from the fixed synthetic project, not a generated legacy argument list. */
export function expectedAssemblySelection(film) {
  return film.shots.flatMap((shot) => {
    const take = shot.selectedTakeId
      ? shot.takes.find((t) => t.id === shot.selectedTakeId && t.status === "done" && t.videoPath)
      : shot.takes.find((t) => t.status === "done" && t.videoPath);
    return take ? [{ shotId: shot.id, takeId: take.id }] : [];
  });
}

/** Exact count/order/project/selection/CAS admission; no arbitrary revision-count tolerance. */
export function assertAssemblyRequests(calls, films) {
  assert.equal(calls.length, films.length);
  const operations = new Set();
  calls.forEach((call, index) => {
    assert.deepEqual(Object.keys(call.input).sort(), [
      "expectedHash",
      "expectedSelection",
      "projectId",
    ]);
    assert.equal(call.matched, true);
    assert.equal(call.input.projectId, films[index].id);
    assert.match(call.input.expectedHash, /^[a-f0-9]{64}$/u);
    assert.equal(call.input.expectedHash, call.canonicalHash);
    assert.deepEqual(call.audioMix, films[index].audioMix ?? null);
    assert.equal(call.subtitleStyle, films[index].subtitleStyle ?? "white");
    assert.deepEqual(call.input.expectedSelection, expectedAssemblySelection(films[index]));
    assert.deepEqual(call.input.expectedSelection, call.expectedSelection);
    assert.match(
      call.operationId,
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u,
    );
    assert.equal(operations.has(call.operationId), false);
    operations.add(call.operationId);
  });
}

/** Wait for observed work in this real rendered project/stage; never synthesize a flush. */
export async function waitAssemblyIdle(page, projectId) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
      ),
  );
  const marker = await page.evaluate((projectId) => {
    const audit = window.__assemblyAudit,
      scope = audit.scope();
    const own = audit.saveTimers.filter(
      (t) => t.projectId === projectId && t.stage === scope.stage,
    );
    const marker = {
      projectId,
      stage: scope.stage,
      generation: own.at(-1)?.generation ?? 0,
      operationId:
        audit.calls.filter((call) => call.input?.projectId === projectId).at(-1)?.operationId ??
        null,
    };
    audit.lastReadiness = marker;
    return scope.projectId === projectId ? marker : null;
  }, projectId);
  assert.ok(
    marker?.generation,
    "The current project must have an observed Pro autosave generation",
  );
  await page.waitForFunction((marker) => {
    const audit = window.__assemblyAudit,
      scope = audit.scope();
    const own = audit.saveTimers.filter(
      (t) => t.projectId === marker.projectId && t.stage === marker.stage,
    );
    return (
      scope.projectId === marker.projectId &&
      scope.stage === marker.stage &&
      (audit.calls.filter((call) => call.input?.projectId === marker.projectId).at(-1)
        ?.operationId ?? null) === marker.operationId &&
      (own.at(-1)?.generation ?? 0) >= marker.generation &&
      own.every((t) => t.status !== "scheduled") &&
      !audit.saveTimers.some((t) => t.projectId === null && t.status === "scheduled") &&
      !(audit.pendingWrites[marker.projectId] > 0) &&
      !(audit.pendingNative[marker.projectId] > 0) &&
      !window.document.querySelector(".statusbar .where")?.textContent.includes("正在保存")
    );
  }, marker);
}
