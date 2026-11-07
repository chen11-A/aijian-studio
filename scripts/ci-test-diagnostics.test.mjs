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
