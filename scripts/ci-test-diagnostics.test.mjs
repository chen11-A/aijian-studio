import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  escapeData,
  escapeProperty,
  failureSummary,
  pytestSourceLocation,
  pytestFailureLocation,
  emptySpeechPcmSummary,
  recoveryIdentitySummary,
  libraryWritePhaseSummary,
  libraryWriteInvocation,
  deliveryManifestInvocation,
  pnpmInvocation,
  runTestDiagnostics,
} from "./ci-test-diagnostics.mjs";

function output() {
  const stream = new PassThrough();
  let text = "";
  stream.on("data", (chunk) => {
    text += chunk.toString();
  });
  return { stream, text: () => text };
}

const fixtureProgram =
  "process.stdout.write(JSON.stringify({ fixture: 'ci-launcher', argv: process.argv.slice(2) }));\n";

async function assertFixtureEntry(invocation, entry, expectedCommand = process.execPath) {
  assert.equal(invocation.command, expectedCommand);
  assert.equal(invocation.args.length, 2);
  assert.equal(invocation.args[1], "test");
  const [returned, fixture] = await Promise.all([
    stat(invocation.args[0], { bigint: true }),
    stat(entry, { bigint: true }),
  ]);
  assert.equal(returned.dev, fixture.dev);
  assert.equal(returned.ino, fixture.ino);
  // Execute the returned arguments with this host's real Node, including on Windows.
  const executed = spawnSync(process.execPath, invocation.args, { encoding: "utf8", shell: false });
  assert.equal(executed.status, 0);
  assert.equal(executed.stderr, "");
  assert.deepEqual(JSON.parse(executed.stdout), { fixture: "ci-launcher", argv: ["test"] });
}

test("pnpm run launcher uses a JS entry as one argument, including Windows node and spaces; never .cmd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ci launcher space-"));
  try {
    const entry = join(directory, "pnpm with spaces.cjs");
    await writeFile(entry, fixtureProgram);
    const executable = "C:\\Program Files\\nodejs\\node.exe";
    await assertFixtureEntry(pnpmInvocation(entry, executable), entry, executable);
    assert.throws(
      () => pnpmInvocation(join(directory, "pnpm.cmd")),
      /PNPM_JAVASCRIPT_ENTRY_REQUIRED/,
    );
    assert.throws(() => pnpmInvocation(""), /PNPM_JAVASCRIPT_ENTRY_REQUIRED/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("directory aliases preserve launcher file identity and execute the CLI probe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ci alias-"));
  try {
    const actual = join(directory, "actual directory");
    const alias = join(directory, "alias directory");
    await mkdir(actual);
    await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
    const fixture = join(actual, "pnpm.cjs");
    await writeFile(fixture, fixtureProgram);
    const entry = join(alias, "pnpm.cjs");
    assert.notEqual(entry, fixture);
    await assertFixtureEntry(pnpmInvocation(entry), fixture);
    await copyFile(
      fileURLToPath(new URL("./ci-test-diagnostics.mjs", import.meta.url)),
      join(actual, "ci-test-diagnostics.mjs"),
    );
    const probe = spawnSync(
      process.execPath,
      [join(alias, "ci-test-diagnostics.mjs"), "--check-launcher"],
      {
        encoding: "utf8",
        shell: false,
        env: { ...process.env, npm_execpath: entry },
      },
    );
    assert.equal(probe.status, 0);
    assert.match(probe.stdout, /CI launcher verified/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workflow annotation escaping cannot create a second command or property", () => {
  assert.equal(escapeData("100%\r\n::error::injected"), "100%25%0D%0A::error::injected");
  assert.equal(escapeProperty("title:,\r\n%"), "title%3A%2C%0D%0A%25");
});

test("Windows Node test failure blocks expose bounded media metadata, not raw errors or absolute paths", () => {
  const summary = failureSummary();
  for (const line of [
    "✖ a test failed (180001ms)",
    "  location: 'D:\\a\\repo\\packages\\aivora-media\\test\\archive.test.mjs:120:3'",
    "  failureType: 'testTimeoutFailure'",
    "  error: 'test timed out after 180000ms'",
    "  code: 'ERR_TEST_FAILURE'",
    "  token=FAKE_SECRET_VALUE local-user-private-value",
  ])
    summary.line(line);
  const entries = summary.entries();
  assert.equal(entries[0].phase, "TypeScript / media");
  assert.match(JSON.stringify(entries), /archive.test.mjs:120/);
  assert.match(JSON.stringify(entries), /180000 ms/);
  assert.match(JSON.stringify(entries), /testTimeoutFailure/);
  assert.doesNotMatch(JSON.stringify(entries), /D:|FAKE_SECRET_VALUE|local-user-private/);
});

test("coverage numbers and pytest failure files distinguish web and Python without assertion values", () => {
  const summary = failureSummary();
  summary.line("RUN v4.1.10 D:\\a\\repo\\apps\\studio-web");
  summary.line("ERROR: Coverage for statements (89.25%) does not meet global threshold (90%)");
  summary.line("platform win32 -- Python 3.12.10, pytest-8");
  summary.line(
    "FAILED services/api/tests/test_story_film.py::test_example[PRIVATE_VALUE] - user=/private/user",
  );
  assert.deepEqual(summary.entries(), [
    { phase: "TypeScript / web", message: "Coverage statements: 89.25%, required 90%." },
    { phase: "Python", message: "Failure location: services/api/tests/test_story_film.py" },
  ]);
});

test("successful real child keeps stdout/stderr bytes and exit zero, without annotations", async () => {
  const stdout = output();
  const stderr = output();
  const status = await runTestDiagnostics({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('hello\\r\\nFAIL src/example.test.ts\\n'); process.stderr.write('stderr\\n');",
    ],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(status, 0);
  assert.equal(stdout.text(), "hello\r\nFAIL src/example.test.ts\n");
  assert.equal(stderr.text(), "stderr\n");
  assert.doesNotMatch(stdout.text(), /::error/);
});

test("failing real child preserves exact exit code and original output, appending only safe annotations", async () => {
  const stdout = output();
  const stderr = output();
  const status = await runTestDiagnostics({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('hello\\n'); process.stderr.write('FAIL src/example.test.ts:9 > FAKE_SECRET_VALUE\\n'); process.exitCode=7;",
    ],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(status, 7);
  assert.match(stdout.text(), /^hello\n::error title=CI Test/);
  assert.match(stdout.text(), /exit 7/);
  assert.match(stdout.text(), /src\/example.test.ts:9/);
  assert.doesNotMatch(stdout.text(), /FAKE_SECRET_VALUE/);
  assert.equal(stderr.text(), "FAIL src/example.test.ts:9 > FAKE_SECRET_VALUE\n");
});

test("unknown failures still preserve the real exit code, with a fixed non-sensitive fallback", async () => {
  const stdout = output();
  const stderr = output();
  const status = await runTestDiagnostics({
    command: process.execPath,
    args: ["-e", "process.stderr.write('unrecognized PRIVATE_VALUE\\n'); process.exitCode=23;"],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(status, 23);
  assert.match(stdout.text(), /No supported safe failure metadata/);
  assert.doesNotMatch(stdout.text(), /PRIVATE_VALUE/);
});

test("failure metadata annotations are bounded and repeated locations deduplicate", () => {
  const summary = failureSummary();
  for (let index = 0; index < 100; index += 1) summary.line(`FAIL src/example${index}.test.ts:1`);
  assert.equal(summary.entries().length, 6);
  summary.line("FAIL src/example0.test.ts:1");
  assert.equal(summary.entries().length, 6);
});

test("Vitest worker exits and fixed pool failure kinds are detected without a FAIL heading", () => {
  const variants = [
    [
      "Error: Worker exited unexpectedly PRIVATE_VALUE /private/token",
      "Test worker exited unexpectedly.",
    ],
    [
      "Error: [vitest-pool]: Worker forks emitted error. PRIVATE_VALUE",
      "Vitest pool: worker error.",
    ],
    [
      "Error: [vitest-pool]: Failed to start threads worker for test files D:/PRIVATE_VALUE.test.ts.",
      "Vitest pool: start failure.",
    ],
    [
      "[vitest-pool]: Failed to terminate vmThreads worker for test files /PRIVATE_VALUE.test.ts.",
      "Vitest pool: termination failure.",
    ],
    [
      "Error: [vitest-pool]: Timeout starting vmForks runner. PRIVATE_VALUE",
      "Vitest pool: start timeout.",
    ],
    [
      "[vitest-pool]: Timeout terminating forks worker for test files /PRIVATE_VALUE.test.ts.",
      "Vitest pool: termination timeout.",
    ],
  ];
  for (const [line, message] of variants) {
    const summary = failureSummary();
    summary.line("RUN v4.1.10 /repo/apps/studio-web");
    for (const prefix of ["", "apps/studio-web test: ", "@aijian/studio-web:test: "]) {
      summary.line(prefix + line);
      assert.deepEqual(summary.entries(), [{ phase: "TypeScript / web", message }]);
    }
  }
});

test("only Node's fixed heap-limit fatal phrases become a fixed category", () => {
  for (const phrase of ["Reached heap limit", "Ineffective mark-compacts near heap limit"]) {
    const summary = failureSummary("TypeScript / web");
    summary.line(
      `FATAL ERROR: ${phrase} Allocation failed - JavaScript heap out of memory PRIVATE_VALUE /private/key`,
    );
    assert.deepEqual(summary.entries(), [
      { phase: "TypeScript / web", message: "Node heap limit reached." },
    ]);
  }
  const summary = failureSummary();
  summary.line("FATAL ERROR: PRIVATE_VALUE /private/key");
  summary.line("user said Worker exited unexpectedly PRIVATE_VALUE");
  assert.deepEqual(summary.entries(), []);
});

test("actual Vitest Test/Hook timed-out-in grammar and Node after grammar retain only valid bounded durations", () => {
  for (const [line, expected] of [
    ["Error: Test timed out in 5000ms. PRIVATE_VALUE", 5000],
    ["Hook timed out in 10000ms. PRIVATE_VALUE", 10000],
    ["FAIL test timed out after 180000ms PRIVATE_VALUE", 180000],
  ]) {
    const summary = failureSummary();
    summary.line(line);
    assert.deepEqual(summary.entries(), [
      { phase: "pnpm test", message: `Test timeout: ${expected} ms.` },
    ]);
  }
  for (const duration of ["0", "-1", "NaN", "Infinity", "2147483648", "999999999999999999999999"]) {
    const summary = failureSummary();
    summary.line(`Error: Test timed out in ${duration}ms. PRIVATE_VALUE`);
    assert.deepEqual(summary.entries(), []);
  }
});

test("coverage metadata keeps original ERROR formats and rejects invalid or unbounded percentages", () => {
  for (const scope of ["global", '"src/example.ts"']) {
    const summary = failureSummary();
    summary.line(
      `ERROR: Coverage for branches (79.95%) does not meet ${scope} threshold (80%) PRIVATE_VALUE`,
    );
    assert.deepEqual(summary.entries(), [
      { phase: "pnpm test", message: "Coverage branches: 79.95%, required 80%." },
    ]);
  }
  for (const value of ["NaN", "Infinity", "101", "1234567890", "1.2.3"]) {
    const summary = failureSummary();
    summary.line(`ERROR: Coverage for branches (${value}%) does not meet global threshold (80%)`);
    assert.deepEqual(summary.entries(), []);
  }
});

// Observed in the local b9 Python run: 5330 passed / 6 skipped, checker exit 1.
// This is evidence of the local checker failure, not the unavailable historical CI log.
const pythonCoverageFailure = "Python coverage: line=92.03% (min 90.0%), branch=83.25% (min 83.5%)";

test("Python checker metadata reports only metrics strictly below their own minimum", () => {
  for (const [line, expected] of [
    [pythonCoverageFailure, ["Coverage branches: 83.25%, required 83.5%."]],
    [
      "Python coverage: line=89.99% (min 90.0%), branch=83.50% (min 83.5%)",
      ["Coverage lines: 89.99%, required 90.0%."],
    ],
    [
      "Python coverage: line=89.99% (min 90.0%), branch=83.49% (min 83.5%)",
      ["Coverage lines: 89.99%, required 90.0%.", "Coverage branches: 83.49%, required 83.5%."],
    ],
    ["Python coverage: line=90.00% (min 90.0%), branch=83.50% (min 83.5%)", []],
    ["Python coverage: line=100.00% (min 100.0%), branch=0.00% (min 0.0%)", []],
    [
      "Python coverage: line=0.00% (min 100.0%), branch=100.00% (min 100.0%)",
      ["Coverage lines: 0.00%, required 100.0%."],
    ],
  ]) {
    const summary = failureSummary("TypeScript / web");
    summary.line(line);
    summary.line(line + "\r"); // The same checker on CRLF streams deduplicates.
    assert.deepEqual(
      summary.entries(),
      expected.map((message) => ({ phase: "Python", message })),
    );
    assert.equal(summary.phase(), "Python");
  }
});

test("Python checker rejects malformed numbers, out-of-range fields and any extra text", () => {
  const fields = ["92.03", "90.0", "83.25", "83.5"];
  const invalid = [];
  for (const field of fields) {
    for (const value of [
      "NaN",
      "Infinity",
      "-1.00",
      "100.01",
      "100.1",
      "101.00",
      "101.0",
      "1e2",
      "1.2.3",
      "9999999999999999999999",
    ])
      invalid.push(pythonCoverageFailure.replace(field, value));
  }
  invalid.push(
    pythonCoverageFailure + " PRIVATE_VALUE /private/token=SECRET",
    pythonCoverageFailure + " ",
    pythonCoverageFailure + "\n",
    "PRIVATE_VALUE " + pythonCoverageFailure,
    pythonCoverageFailure.replace("branch=", "branch=PRIVATE_VALUE"),
    pythonCoverageFailure.replace(", branch=83.25% (min 83.5%)", ""),
    pythonCoverageFailure.replace("line=", "lines="),
  );
  for (const line of invalid) {
    const summary = failureSummary("TypeScript / web");
    summary.line(line);
    assert.deepEqual(summary.entries(), [], line);
    assert.equal(summary.phase(), "TypeScript / web", line);
  }
});

test("real child Python checker output preserves streams and exit status with only safe failure annotations", async () => {
  for (const exitCode of [0, 1, 7]) {
    const stdout = output();
    const stderr = output();
    const privateError = "invalid coverage report: PRIVATE_VALUE /private/token=SECRET\n";
    const status = await runTestDiagnostics({
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(${JSON.stringify(pythonCoverageFailure)}); process.stderr.write(${JSON.stringify(privateError)}); process.exitCode=${exitCode};`,
      ],
      stdout: stdout.stream,
      stderr: stderr.stream,
      phase: "TypeScript / web",
    });
    assert.equal(status, exitCode);
    assert.equal(stderr.text(), privateError);
    assert.equal(
      stdout.text(),
      pythonCoverageFailure +
        (exitCode === 0
          ? ""
          : `::error title=CI Test / Python / exit ${exitCode}::Coverage branches: 83.25%25, required 83.5%25.\n`),
    );
    assert.doesNotMatch(stdout.text(), /PRIVATE_VALUE|private\/token|SECRET/);
  }
});

test("restricted source positions and failure codes cannot be arbitrary log values", () => {
  const summary = failureSummary();
  summary.line("Error: Worker exited unexpectedly");
  summary.line("user body src/PRIVATE_VALUE.test.ts:42 ERR_PRIVATE_VALUE");
  summary.line("at src/../../PRIVATE_VALUE.test.ts:42");
  summary.line("at src/valid.test.ts:9999999999999999999999");
  summary.line(`at src/${"x".repeat(250)}.test.ts:1`);
  summary.line("at src/valid.test.ts:42:7");
  summary.line("code: ERR_WORKER_OUT_OF_MEMORY PRIVATE_VALUE");
  assert.deepEqual(summary.entries(), [
    { phase: "pnpm test", message: "Test worker exited unexpectedly." },
    { phase: "pnpm test", message: "Failure location: src/valid.test.ts:42" },
    { phase: "pnpm test", message: "Failure code: ERR_WORKER_OUT_OF_MEMORY." },
  ]);
});

test("real failing child preserves streams/status while runtime annotations omit every private tail", async () => {
  const stdout = output(),
    stderr = output();
  const raw =
    [
      "RUN v4.1.10 D:/repo/apps/studio-web",
      "Error: Worker exited unexpectedly PRIVATE_VALUE",
      "Error: Test timed out in 5000ms. /private/path?token=PRIVATE_VALUE",
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory PRIVATE_VALUE",
      "at src/example.test.ts:23:9 PRIVATE_VALUE",
      "code: ERR_PRIVATE_VALUE",
    ].join("\n") + "\n";
  const status = await runTestDiagnostics({
    command: process.execPath,
    args: [
      "-e",
      `process.stdout.write('original stdout\\n');process.stderr.write(${JSON.stringify(raw)});process.exitCode=29;`,
    ],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(status, 29);
  assert.equal(stderr.text(), raw);
  assert(stdout.text().startsWith("original stdout\n"));
  const annotations = stdout
    .text()
    .split("\n")
    .filter((line) => line.startsWith("::error"));
  assert.equal(annotations.length, 4);
  assert(annotations.every((line) => line.includes("exit 29")));
  assert.doesNotMatch(annotations.join("\n"), /PRIVATE_VALUE|private|D:|token=|ERR_PRIVATE/);
});

test("pytest node metadata uses a real repository declaration and excludes parameters and exception values", async () => {
  const file = "services/api/tests/test_story_speech_window.py",
    name = "test_padding_preserves_every_body_sample_and_original_bytes";
  const summary = failureSummary();
  summary.line(
    `FAILED ${file.replaceAll("/", "\\")}::${name}[PRIVATE_PARAMETER] - AssertionError: PRIVATE_EXCEPTION /private/user`,
  );
  const declaredLine = pytestSourceLocation(file, name);
  assert.equal(typeof declaredLine, "number");
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  assert(source.split(/\r?\n/u)[declaredLine - 1].startsWith(`def ${name}(`));
  assert.deepEqual(summary.entries(), [
    { phase: "Python", message: `Failure location: ${file}` },
    { phase: "Python", message: `Failure test: ${file}::${name}:${declaredLine}` },
  ]);
  assert.doesNotMatch(JSON.stringify(summary.entries()), /PRIVATE|AssertionError|private\/user/);
});

test("pytest declaration whitelist rejects forged names, nested methods, traversal, oversized source and directory aliases escaping the checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pytest-safe-locator-"));
  try {
    const tests = join(directory, "services/api/tests");
    await mkdir(tests, { recursive: true });
    const file = "services/api/tests/test_fixture.py";
    await writeFile(
      join(directory, file),
      "def test_real():\n    pass\n\nasync def test_async():\n    pass\n\nclass TestPrivate:\n    def test_nested(self):\n        pass\n",
    );
    assert.equal(pytestSourceLocation(file, "test_real", directory), 1);
    assert.equal(pytestSourceLocation(file, "test_async", directory), 4);
    for (const name of [
      "test_forged",
      "test_nested",
      "test_real[PRIVATE]",
      "not_test",
      "test_" + "x".repeat(160),
    ])
      assert.equal(pytestSourceLocation(file, name, directory), null);
    for (const unsafe of [
      "services/api/tests/../test_fixture.py",
      "/services/api/tests/test_fixture.py",
      "private/test_fixture.py",
    ])
      assert.equal(pytestSourceLocation(unsafe, "test_real", directory), null);
    await writeFile(join(tests, "test_large.py"), "def test_real():\n" + "#".repeat(1024 * 1024));
    assert.equal(
      pytestSourceLocation("services/api/tests/test_large.py", "test_real", directory),
      null,
    );
    const aliasRoot = join(directory, "alias-root"),
      outside = join(directory, "outside");
    await mkdir(join(aliasRoot, "services/api"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "test_escape.py"), "def test_private():\n    pass\n");
    await symlink(
      outside,
      join(aliasRoot, "services/api/tests"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.equal(
      pytestSourceLocation("services/api/tests/test_escape.py", "test_private", aliasRoot),
      null,
    );
    const summary = failureSummary("Python", directory);
    summary.line(`FAILED ${file}::test_forged[PRIVATE_PARAMETER] - PRIVATE_EXCEPTION`);
    summary.line(`FAILED ${file}::TestPrivate::test_nested - PRIVATE_EXCEPTION`);
    assert.deepEqual(summary.entries(), [
      { phase: "Python", message: `Failure location: ${file}` },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pytest node metadata preserves the original six-entry bound", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pytest-bounded-locator-"));
  try {
    await mkdir(join(directory, "services/api/tests"), { recursive: true });
    const file = "services/api/tests/test_fixture.py";
    await writeFile(
      join(directory, file),
      Array.from({ length: 20 }, (_, index) => `def test_item_${index}():\n    pass`).join("\n"),
    );
    const summary = failureSummary("Python", directory);
    for (let index = 0; index < 20; index++)
      summary.line(`FAILED ${file}::test_item_${index}[PRIVATE] - PRIVATE`);
    assert.equal(summary.entries().length, 6);
    assert.equal(
      summary.entries().filter((entry) => entry.message.startsWith("Failure test:")).length,
      5,
    );
    assert.doesNotMatch(JSON.stringify(summary.entries()), /PRIVATE/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real pytest-shaped child keeps stdout, stderr and failure status while annotations show only verified node metadata", async () => {
  const stdout = output(),
    stderr = output();
  const raw =
    "FAILED services/api/tests/test_story_speech_window.py::test_padding_preserves_every_body_sample_and_original_bytes[PRIVATE_PARAMETER] - PRIVATE_EXCEPTION\n";
  const status = await runTestDiagnostics({
    command: process.execPath,
    args: [
      "-e",
      `process.stdout.write(${JSON.stringify(raw)});process.stderr.write('original stderr\\n');process.exitCode=17;`,
    ],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(status, 17);
  assert.equal(stderr.text(), "original stderr\n");
  assert(stdout.text().startsWith(raw));
  const annotations = stdout
    .text()
    .split("\n")
    .filter((line) => line.startsWith("::error"));
  assert.equal(annotations.length, 2);
  assert(annotations.every((line) => line.includes("exit 17")));
  assert.match(
    annotations.join("\n"),
    /::test_padding_preserves_every_body_sample_and_original_bytes/,
  );
  assert.doesNotMatch(annotations.join("\n"), /PRIVATE|AssertionError|private\//);
});

test("fixed speech-window CLI uses the original pytest vector without pnpm, and preserves real child success/failure status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "speech cli hook-"));
  try {
    const hook = join(directory, "spawn-hook.cjs"),
      record = join(directory, "invocation.json");
    const line =
      "FAILED services/api/tests/test_story_speech_window.py::test_padding_preserves_every_body_sample_and_original_bytes[PRIVATE_PARAMETER] - PRIVATE_EXCEPTION\n";
    const script = fileURLToPath(new URL("./ci-test-diagnostics.mjs", import.meta.url));
    for (const status of [0, 23]) {
      const child = `process.stdout.write(${JSON.stringify(line)});process.stderr.write('original stderr\\n');process.exitCode=${status};`;
      await writeFile(
        hook,
        `const fs=require('node:fs'),cp=require('node:child_process');const original=cp.spawn;cp.spawn=(command,args,options)=>{fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({command,args,shell:options.shell}));return original(process.execPath,['-e',${JSON.stringify(child)}],options);};require('node:module').syncBuiltinESMExports();`,
      );
      const result = spawnSync(
        process.execPath,
        ["--require", hook, script, "--speech-window-test"],
        { encoding: "utf8", shell: false, env: { ...process.env, npm_execpath: "" } },
      );
      assert.equal(result.status, status);
      assert.equal(result.stderr, "original stderr\n");
      assert(result.stdout.startsWith(line));
      assert.deepEqual(JSON.parse(await readFile(record, "utf8")), {
        command: "uv",
        args: ["run", "pytest", "services/api/tests/test_story_speech_window.py"],
        shell: false,
      });
      const annotations = result.stdout.split("\n").filter((value) => value.startsWith("::error"));
      assert.equal(annotations.length, status === 0 ? 0 : 2);
      assert(annotations.every((value) => value.includes(`exit ${status}`)));
      assert.doesNotMatch(annotations.join("\n"), /PRIVATE|AssertionError/);
    }
    await rm(record);
    const rejected = spawnSync(
      process.execPath,
      ["--require", hook, script, "--speech-window-test", "PRIVATE_PATH.py"],
      { encoding: "utf8", shell: false },
    );
    assert.equal(rejected.status, 1);
    await assert.rejects(readFile(record, "utf8"), { code: "ENOENT" });
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /PRIVATE_PATH/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pytest failure sections expose the verified actual failure frame separately from a test definition without error values", async () => {
  const file = "services/api/tests/test_story_speech_window.py",
    name = "test_empty_spoken_text_has_no_synthetic_window_or_policy";
  const source = (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).split(/\r?\n/u);
  const definition = pytestSourceLocation(file, name),
    actual =
      source.findIndex(
        (line, index) =>
          index >= definition &&
          line.includes('assert result.status == "SUCCEEDED", result.message'),
      ) + 1;
  assert(actual > definition);
  assert.equal(pytestFailureLocation(file, actual), actual);
  const summary = failureSummary();
  summary.line(`${file}:${actual}: AssertionError: PRIVATE_OUTSIDE_SECTION`);
  assert.deepEqual(summary.entries(), []);
  summary.line("====================== FAILURES ======================");
  summary.line(`${file.replaceAll("/", "\\")}:${actual}: AssertionError: PRIVATE_EXCEPTION_VALUE`);
  summary.line("E PRIVATE_ASSERTION_VALUE");
  summary.line("================ short test summary info ================");
  summary.line(`${file}:${actual + 1}: RuntimeError: PRIVATE_OUTSIDE_SECTION`);
  summary.line(`FAILED ${file}::${name}[PRIVATE_PARAMETER] - PRIVATE_EXCEPTION_VALUE`);
  assert.deepEqual(summary.entries(), [
    { phase: "Python", message: `Pytest failure frame: ${file}:${actual} (AssertionError).` },
    { phase: "Python", message: `Failure location: ${file}` },
    { phase: "Python", message: `Failure test: ${file}::${name}:${definition}` },
  ]);
  assert.doesNotMatch(JSON.stringify(summary.entries()), /PRIVATE|E PRIVATE/);
});

test("pytest actual frame metadata rejects unverified files, out-of-source positions, open exception names and non-frame prose", () => {
  const file = "services/api/tests/test_story_speech_window.py",
    summary = failureSummary();
  summary.line("================ FAILURES ================");
  for (const row of [
    `${file}:99999999: AssertionError: PRIVATE`,
    `${file}:0: AssertionError`,
    `${file}:-1: AssertionError`,
    `${file}:391: PrivateError: PRIVATE`,
    "services/api/tests/../test_private.py:1: AssertionError",
    "services/api/tests/test_missing_private.py:1: AssertionError",
    `Error in ${file}:391: AssertionError`,
  ])
    summary.line(row);
  assert.deepEqual(summary.entries(), []);
  assert.equal(pytestFailureLocation(file, 99999999), null);
});

test("closed PCM diagnostics show only bounded physical numbers inside pytest failure sections", () => {
  const value = {
    schema: 1,
    referenced: true,
    stage: "loudnorm",
    ordinal: 2,
    rate: 48000,
    channels: 2,
    width: 2,
    samples: 9600,
    nonzero: 24,
    peakAbs: 1,
    rms: 0.05,
  };
  const raw = "CI_EMPTY_SPEECH_PCM " + JSON.stringify(value),
    expected =
      "Empty speech PCM: referenced=true; stage=loudnorm#2; rate=48000; channels=2; width=2; samples=9600; nonzero=24; peakAbs=1; RMS=0.050000.";
  assert.equal(emptySpeechPcmSummary(raw), expected);
  const summary = failureSummary();
  summary.line(raw);
  assert.deepEqual(summary.entries(), []);
  summary.line("================ FAILURES ================");
  summary.line(raw);
  assert.deepEqual(summary.entries(), [{ phase: "Python", message: expected }]);
  const zero = {
    ...value,
    stage: "silent",
    rate: 16000,
    channels: 1,
    samples: 3200,
    nonzero: 0,
    peakAbs: 0,
    rms: 0,
  };
  assert.match(
    emptySpeechPcmSummary("CI_EMPTY_SPEECH_PCM " + JSON.stringify(zero)),
    /nonzero=0; peakAbs=0; RMS=0.000000/,
  );
});

test("PCM diagnostic whitelist rejects secrets, arbitrary text, non-finite or physically invalid numbers and unknown formats", () => {
  const valid = {
    schema: 1,
    referenced: false,
    stage: "final",
    ordinal: 4,
    rate: 48000,
    channels: 2,
    width: 2,
    samples: 9600,
    nonzero: 24,
    peakAbs: 1,
    rms: 0.05,
  };
  for (const invalid of [
    { ...valid, path: "PRIVATE_PATH" },
    { ...valid, stage: "PRIVATE_STAGE" },
    { ...valid, referenced: "PRIVATE_PARAMETER" },
    { ...valid, schema: 2 },
    { ...valid, ordinal: 17 },
    { ...valid, rate: 44100 },
    { ...valid, channels: 8 },
    { ...valid, width: 4 },
    { ...valid, samples: 2000002 },
    { ...valid, samples: 1 },
    { ...valid, nonzero: 9601 },
    { ...valid, nonzero: -1 },
    { ...valid, peakAbs: 32769 },
    { ...valid, rms: 2 },
    { ...valid, nonzero: 0 },
    { ...valid, rms: 0 },
    { ...valid, samples: "9600" },
  ])
    assert.equal(emptySpeechPcmSummary("CI_EMPTY_SPEECH_PCM " + JSON.stringify(invalid)), null);
  for (const raw of [
    "CI_EMPTY_SPEECH_PCM " + JSON.stringify(valid).replace('"rms":0.05', '"rms":NaN'),
    "CI_EMPTY_SPEECH_PCM " + JSON.stringify(valid).replace('"rms":0.05', '"rms":Infinity'),
    "PRIVATE arbitrary text",
    "CI_EMPTY_SPEECH_PCM " + "x".repeat(3000),
    'CI_EMPTY_SPEECH_PCM {"path":"PRIVATE_PATH"}',
  ])
    assert.equal(emptySpeechPcmSummary(raw), null);
  const summary = failureSummary();
  summary.line("================ FAILURES ================");
  summary.line('CI_EMPTY_SPEECH_PCM {"path":"PRIVATE_PATH"}');
  assert.deepEqual(summary.entries(), []);
});

test("accepts only bounded closed library-write phases and retains the six-annotation ceiling", () => {
  const valid = {
    v: 1,
    mode: "readback-wrong",
    stage: "apply",
    elapsedMs: 4901,
    completed: [
      { stage: "fixture", elapsedMs: 200 },
      { stage: "suggest", elapsedMs: 300 },
    ],
    probes: 12,
  };
  for (const mode of [
    "before",
    "after",
    "unreadable",
    "readback-stale",
    "readback-empty",
    "readback-wrong",
  ])
    assert(
      libraryWritePhaseSummary("CI_LIBRARY_WRITE_PHASE " + JSON.stringify({ ...valid, mode })),
    );
  const line = "CI_LIBRARY_WRITE_PHASE " + JSON.stringify(valid);
  assert.match(
    libraryWritePhaseSummary(line),
    /variant=readback-wrong; stage=apply; elapsed=4901ms/,
  );
  const summary = failureSummary();
  summary.line(line);
  assert.deepEqual(summary.entries(), []);
  summary.line("FAIL src/film-audio-library.test.ts > PRIVATE_PARAM");
  assert.match(summary.entries()[0].message, /Audio library write phase/);
  for (let index = 0; index < 10; index++)
    summary.line("CI_LIBRARY_WRITE_PHASE " + JSON.stringify({ ...valid, elapsedMs: 4901 + index }));
  assert.equal(summary.entries().length, 6);
  assert.doesNotMatch(JSON.stringify(summary.entries()), /PRIVATE/);
});
test("rejects private strings, unknown shape, nonfinite and unbounded library-write metadata", () => {
  const valid = {
    v: 1,
    mode: "before",
    stage: "write",
    elapsedMs: 100,
    completed: [{ stage: "fixture", elapsedMs: 50 }],
    probes: 0,
  };
  for (const row of [
    { ...valid, path: "PRIVATE_PATH" },
    { ...valid, mode: "PRIVATE_PARAM" },
    { ...valid, stage: "PRIVATE_STAGE" },
    { ...valid, elapsedMs: -1 },
    { ...valid, elapsedMs: 120001 },
    { ...valid, elapsedMs: "100" },
    { ...valid, probes: 4097 },
    { ...valid, probes: NaN },
    { ...valid, completed: [null] },
    { ...valid, completed: [{ stage: "fixture", elapsedMs: 120 }] },
    { ...valid, completed: Array(17).fill({ stage: "write", elapsedMs: 1 }) },
    { ...valid, completed: [{ stage: "fixture", elapsedMs: 1, secret: "PRIVATE" }] },
  ])
    assert.equal(libraryWritePhaseSummary("CI_LIBRARY_WRITE_PHASE " + JSON.stringify(row)), null);
  for (const row of [
    "PRIVATE",
    "CI_LIBRARY_WRITE_PHASE " + "x".repeat(3000),
    "CI_LIBRARY_WRITE_PHASE " + JSON.stringify(valid).replace('"elapsedMs":100', '"elapsedMs":NaN'),
    "CI_LIBRARY_WRITE_PHASE " +
      JSON.stringify(valid).replace('"elapsedMs":100', '"elapsedMs":Infinity'),
  ])
    assert.equal(libraryWritePhaseSummary(row), null);
});

test("fixed library-write CLI selects the exact original six variants, disables shell and preserves child 0/23 without leaking parameters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "library-write-cli-"));
  try {
    const hook = join(directory, "spawn-hook.cjs"),
      record = join(directory, "invocation.json"),
      entry = join(directory, "pnpm.cjs");
    await writeFile(entry, "process.stdout.write('fixture');");
    const script = fileURLToPath(new URL("./ci-test-diagnostics.mjs", import.meta.url));
    const payload = {
      v: 1,
      mode: "readback-empty",
      stage: "readback",
      elapsedMs: 4900,
      completed: [{ stage: "fixture", elapsedMs: 400 }],
      probes: 12,
    };
    const line =
      "CI_LIBRARY_WRITE_PHASE " +
      JSON.stringify(payload) +
      "\nFAIL src/film-audio-library.test.ts > PRIVATE_PARAMETER\nError: Test timed out in 5000ms.\n";
    const expected = libraryWriteInvocation(entry);
    assert.equal(expected.args.length, 9);
    for (const status of [0, 23]) {
      const child = `process.stdout.write(${JSON.stringify(line)});process.stderr.write('original stderr\\n');process.exitCode=${status};`;
      await writeFile(
        hook,
        `const fs=require('node:fs'),cp=require('node:child_process'),original=cp.spawn;cp.spawn=(command,args,options)=>{fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({command,args,shell:options.shell}));return original(process.execPath,['-e',${JSON.stringify(child)}],options);};require('node:module').syncBuiltinESMExports();`,
      );
      const result = spawnSync(
        process.execPath,
        ["--require", hook, script, "--audio-library-write-test"],
        { encoding: "utf8", shell: false, env: { ...process.env, npm_execpath: entry } },
      );
      assert.equal(result.status, status);
      assert.equal(result.stderr, "original stderr\n");
      assert(result.stdout.startsWith(line));
      const invoked = JSON.parse(await readFile(record, "utf8"));
      assert.equal(invoked.command, process.execPath);
      assert.equal(invoked.shell, false);
      const [actualFile, fixtureFile] = await Promise.all([
        stat(invoked.args[0], { bigint: true }),
        stat(entry, { bigint: true }),
      ]);
      assert.equal(actualFile.dev, fixtureFile.dev);
      assert.equal(actualFile.ino, fixtureFile.ino);
      assert.deepEqual(invoked.args.slice(1), expected.args.slice(1));
      const annotations = result.stdout.split("\n").filter((row) => row.startsWith("::error"));
      assert(
        status === 0 ? annotations.length === 0 : annotations.length > 0 && annotations.length <= 6,
      );
      if (status)
        assert(annotations.some((row) => row.includes("variant=readback-empty; stage=readback")));
      assert.doesNotMatch(
        annotations.join("\n"),
        /PRIVATE|AssertionError|invocation.json|pnpm.cjs/,
      );
    }
    await rm(record);
    const rejected = spawnSync(
      process.execPath,
      ["--require", hook, script, "--audio-library-write-test", "PRIVATE_PATH"],
      { encoding: "utf8", shell: false, env: { ...process.env, npm_execpath: entry } },
    );
    assert.equal(rejected.status, 1);
    await assert.rejects(readFile(record, "utf8"), { code: "ENOENT" });
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /PRIVATE_PATH/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fixed delivery-manifest CLI runs both original files and propagates 0/23; extra arguments never spawn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "delivery-cli-"));
  try {
    const entry = join(directory, "pnpm.cjs"),
      record = join(directory, "child.json");
    const script = fileURLToPath(new URL("./ci-test-diagnostics.mjs", import.meta.url));
    await writeFile(entry, "// Fixed launcher fixture, overwritten before the child executes.");
    const expected = deliveryManifestInvocation(entry);
    assert.equal(expected.command, process.execPath);
    assert.deepEqual(expected.args.slice(1), [
      "--filter",
      "@aijian/desktop",
      "exec",
      "vitest",
      "run",
      "src/film-delivery-manifest.test.ts",
      "src/film-export-qc-ownership.test.ts",
    ]);
    await writeFile(
      entry,
      `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(process.argv.slice(2)));process.stdout.write('FAIL src/film-delivery-manifest.test.ts > PRIVATE_PARAMETER\\nError: PRIVATE_ERROR\\n');process.exitCode=Number(process.env.TARGET_CHILD_EXIT);`,
    );
    for (const status of [0, 23]) {
      const result = spawnSync(process.execPath, [script, "--delivery-manifest-test"], {
        encoding: "utf8",
        shell: false,
        env: { ...process.env, npm_execpath: entry, TARGET_CHILD_EXIT: String(status) },
      });
      assert.equal(result.status, status);
      assert.deepEqual(JSON.parse(await readFile(record, "utf8")), expected.args.slice(1));
      const annotations = result.stdout.split("\n").filter((line) => line.startsWith("::error"));
      assert(
        status === 0 ? annotations.length === 0 : annotations.length > 0 && annotations.length <= 6,
      );
      assert.doesNotMatch(annotations.join("\n"), /PRIVATE|child.json|pnpm.cjs/);
    }
    await rm(record);
    const rejected = spawnSync(
      process.execPath,
      [script, "--delivery-manifest-test", "PRIVATE_FILE"],
      {
        encoding: "utf8",
        shell: false,
        env: { ...process.env, npm_execpath: entry, TARGET_CHILD_EXIT: "0" },
      },
    );
    assert.equal(rejected.status, 1);
    await assert.rejects(readFile(record, "utf8"), { code: "ENOENT" });
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /PRIVATE_FILE/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovery identity diagnostics accept only closed booleans and remain inside pytest failures", () => {
  const flags = [
    "fdStable",
    "fdRegular",
    "pathRegular",
    "sameDevice",
    "sameInode",
    "sameSize",
    "sameMtime",
    "sameCtime",
    "namedHandleMatch",
    "shaMatch",
    "byteCountMatch",
  ];
  const row = {
    schemaVersion: 1,
    stage: "read-path",
    ...Object.fromEntries(flags.map((key) => [key, true])),
  };
  const encode = (value) => `CI_VIDEO_RECOVERY_IDENTITY ${JSON.stringify(value)}`;
  assert.match(recoveryIdentitySummary(encode(row)), /namedHandleMatch=true/);
  for (const invalid of [
    null,
    [],
    { ...row, source: "PRIVATE_PATH" },
    { ...row, stage: "PRIVATE_STAGE" },
    { ...row, schemaVersion: 2 },
    { ...row, sameInode: "PRIVATE_INODE" },
    { ...row, sameCtime: NaN },
    { ...row, shaMatch: 1 },
  ]) {
    assert.equal(recoveryIdentitySummary(encode(invalid)), null);
  }
  assert.equal(recoveryIdentitySummary(encode(row) + "x".repeat(2049)), null);
  const summary = failureSummary();
  summary.line(encode(row));
  assert.equal(summary.entries().length, 0);
  summary.line("============================= FAILURES =============================");
  for (let index = 0; index < 12; index++) {
    summary.line(
      encode({
        ...row,
        fdStable: Boolean(index & 1),
        sameDevice: Boolean(index & 2),
        sameInode: Boolean(index & 4),
        sameSize: Boolean(index & 8),
      }),
    );
  }
  assert.equal(summary.entries().length, 6);
  assert.doesNotMatch(JSON.stringify(summary.entries()), /PRIVATE|sha256|st_ino/);
});

test("fixed recovery CLI executes exactly both original files, preserves exit 23 and rejects caller arguments before spawn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-cli-"));
  try {
    const hook = join(directory, "spawn-hook.cjs"),
      record = join(directory, "invocation.json");
    const script = fileURLToPath(new URL("./ci-test-diagnostics.mjs", import.meta.url));
    for (const status of [0, 23]) {
      const child = `process.stdout.write('original stdout\\n');process.stderr.write('original stderr\\n');process.exitCode=${status};`;
      await writeFile(
        hook,
        `const fs=require('node:fs'),cp=require('node:child_process');const original=cp.spawn;cp.spawn=(command,args,options)=>{fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({command,args,shell:options.shell}));return original(process.execPath,['-e',${JSON.stringify(child)}],options);};require('node:module').syncBuiltinESMExports();`,
      );
      const result = spawnSync(
        process.execPath,
        ["--require", hook, script, "--video-recovery-test"],
        { encoding: "utf8", shell: false, env: { ...process.env, npm_execpath: "" } },
      );
      assert.equal(result.status, status);
      assert.ok(result.stdout.startsWith("original stdout\n"));
      assert.equal(result.stderr, "original stderr\n");
      assert.deepEqual(JSON.parse(await readFile(record, "utf8")), {
        command: "uv",
        args: [
          "run",
          "pytest",
          "services/api/tests/test_video_recovery.py",
          "services/api/tests/test_video_recovery_routes.py",
        ],
        shell: false,
      });
    }
    for (const args of [
      ["--video-recovery-test", "PRIVATE_PATH.py"],
      ["--video-recovery-test-PRIVATE"],
    ]) {
      await rm(record, { force: true });
      const result = spawnSync(process.execPath, ["--require", hook, script, ...args], {
        encoding: "utf8",
        shell: false,
        env: { ...process.env, npm_execpath: join(directory, "pnpm.cjs") },
      });
      assert.equal(result.status, 1);
      await assert.rejects(readFile(record, "utf8"), { code: "ENOENT" });
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_PATH|test-PRIVATE/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
