import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
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
