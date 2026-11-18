import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, onTestFailed, vi, type TestContext } from "vitest";
import { openMutationPhase } from "./film-audio-library-mutation-phase";

const proof = mkdtempSync(join(tmpdir(), "mutation-phase-"));
const pending = new Set<Promise<unknown>>();
afterEach(async () => {
  await Promise.allSettled([...pending]);
  pending.clear();
});

function remember(file: string) {
  return (context: TestContext) => {
    const errors = context.task.result?.errors ?? [];
    writeFileSync(
      file,
      JSON.stringify({
        count: errors.length,
        messages: errors.map((error) => error.message ?? ""),
      }),
    );
  };
}

it("a passing trace stays silent after the near-deadline timer", async () => {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const phase = openMutationPhase({ mode: "picker", linksBundle: true, nearMs: 15 });
    phase.enter("fixture");
    await new Promise((resolve) => setTimeout(resolve, 40));
    phase.enter("done");
    phase.close();
    expect(
      spy.mock.calls.some((call) => String(call[0]).includes("CI_LIBRARY_MUTATION_PHASE")),
    ).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it.fails(
  "timeout keeps the original error and the stage frozen inside the await",
  async () => {
    const errors = join(proof, "timeout-errors.json");
    onTestFailed(remember(errors));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const phase = openMutationPhase({
      mode: "synonyms",
      linksBundle: true,
      nearMs: 40,
      write: (line) => writeFileSync(join(proof, "timeout-phase.txt"), line),
    });
    onTestFailed(remember(errors));
    const resume = setTimeout(() => release(), 110);
    const work = (async () => {
      try {
        phase.enter("fixture");
        phase.enter("apply");
        await gate;
        phase.enter("done");
      } finally {
        clearTimeout(resume);
        phase.close();
      }
    })();
    pending.add(work);
    await work;
  },
  80,
);

it.fails(
  "an assertion stays the only error and the failure sample names the reached stage",
  async () => {
    const errors = join(proof, "assert-errors.json");
    onTestFailed(remember(errors));
    const phase = openMutationPhase({
      mode: "project",
      linksBundle: false,
      nearMs: 5000,
      write: (line) => writeFileSync(join(proof, "assert-phase.txt"), line),
    });
    onTestFailed(remember(errors));
    try {
      phase.enter("fixture");
      phase.enter("suggest");
      expect(false).toBe(true);
    } finally {
      phase.close();
    }
  },
);

it.fails("a diagnostic write failure does not add a second error", async () => {
  const errors = join(proof, "write-errors.json");
  onTestFailed(remember(errors));
  const phase = openMutationPhase({
    mode: "take",
    linksBundle: false,
    nearMs: 5000,
    write() {
      throw new Error("diagnostic write failed");
    },
  });
  onTestFailed(remember(errors));
  try {
    phase.enter("fixture");
    expect(1).toBe(2);
  } finally {
    phase.close();
  }
});

it("the timeout and assertion traces keep one original error", () => {
  const timeout = JSON.parse(
    readFileSync(join(proof, "timeout-phase.txt"), "utf8").replace(
      /^CI_LIBRARY_MUTATION_PHASE /,
      "",
    ),
  );
  expect(timeout.sample).toBe("near-deadline");
  expect(timeout.stage).toBe("apply");
  expect(timeout.mode).toBe("synonyms");
  expect(timeout.boundary.fixture).toBe("reached");
  expect(timeout.boundary.apply).toBe("in-progress");
  expect(timeout.boundary.beforeCommit).toBe("not-reached");
  expect(timeout.boundary.linkBundle).toBe("not-reached");
  expect(timeout.notSampled).toEqual(["recompile", "load", "hash", "cas", "cleanup"]);
  expect(timeout.monoMs).toBeGreaterThan(0);
  const timeoutErrors = JSON.parse(readFileSync(join(proof, "timeout-errors.json"), "utf8"));
  expect(timeoutErrors.count).toBe(1);
  expect(timeoutErrors.messages[0]).toMatch(/^Test timed out in 80ms/);

  const assertion = JSON.parse(
    readFileSync(join(proof, "assert-phase.txt"), "utf8").replace(
      /^CI_LIBRARY_MUTATION_PHASE /,
      "",
    ),
  );
  expect(assertion.sample).toBe("at-failure");
  expect(assertion.stage).toBe("suggest");
  expect(assertion.boundary.linkBundle).toBe("not-applicable");
  expect(assertion.boundary.suggest).toBe("in-progress");
  expect(assertion.notSampled).toEqual(["recompile", "load", "hash", "cas", "cleanup"]);
  const assertionErrors = JSON.parse(readFileSync(join(proof, "assert-errors.json"), "utf8"));
  expect(assertionErrors.count).toBe(1);
  expect(assertionErrors.messages[0]).toContain("expected false to be true");
  expect(assertionErrors.messages[0]).not.toContain("timed out");

  const writeErrors = JSON.parse(readFileSync(join(proof, "write-errors.json"), "utf8"));
  expect(writeErrors.count).toBe(1);
  expect(writeErrors.messages[0]).toContain("expected 1 to be 2");
  expect(writeErrors.messages.join("\n")).not.toContain("diagnostic write failed");
});
