import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";
import ts from "typescript";
import { registerFixedInputHandlers } from "./film-generation-fixed-input-ipc";
import { readProject, writeProject } from "./film-library";
import type { FixedInputLedger } from "./film-generation-fixed-input";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
  "base64",
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function compiledLedger(): Promise<FixedInputLedger> {
  const source = await readFile(join(process.cwd(), "src/film-generation-fixed-input.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(
    tmpdir(),
    `fixed-input-${createHash("sha256").update(js).digest("hex").slice(0, 12)}.cjs`,
  );
  await writeFile(file, js);
  return createRequire(file)(file).createFixedInputLedger() as FixedInputLedger;
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), "fixed-input-channel-"));
  roots.push(root);
  const filmsRoot = join(root, "films");
  const id = `film_${"a".repeat(16)}`;
  const seriesId = `film_${"b".repeat(16)}`;
  const backendProjectId = `prj_${"c".repeat(32)}`;
  await writeProject(filmsRoot, {
    id,
    seriesId,
    title: "手工画面",
    seriesTitle: "手工画面",
    backendProjectId,
    schemaVersion: 1,
  });
  const raw = await readFile(join(filmsRoot, seriesId, "episodes", id, "project.json"));
  return { filmsRoot, id, seriesId, backendProjectId, raw };
}

function handlers(
  ledger: FixedInputLedger,
  env: Awaited<ReturnType<typeof project>>,
  options?: {
    automatic?: boolean;
    picked?: string | null;
    current?: boolean;
  },
) {
  const calls: string[] = [];
  const map = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerFixedInputHandlers((channel, run) => map.set(channel, run), {
    filmsRoot: () => env.filmsRoot,
    ledger,
    authorized: (event: boolean) => event,
    mediaDispatchLease: async () =>
      options?.current === false
        ? null
        : {
            account: { bearer: "native-bearer", accountSha256: "d".repeat(64) },
            current: () => options?.current !== false,
          },
    pickImage: async () => {
      calls.push("pick");
      return options?.picked === undefined ? null : options.picked;
    },
    isAutomaticOutput: async () => {
      calls.push("lineage");
      return options?.automatic === true;
    },
  });
  return { map, calls };
}

it("compiled ledger confirms a real manual still and refuses renderer-shaped extra arguments", async () => {
  const ledger = await compiledLedger();
  const env = await project();
  const still = join(env.filmsRoot, env.seriesId, "stills", "manual.png");
  await mkdir(join(env.filmsRoot, env.seriesId, "stills"), { recursive: true });
  await writeFile(still, png);
  const noted = await ledger.noteManualStill(env.filmsRoot, env.seriesId, still);
  expect(noted.kind).toBe("offer");
  if (noted.kind !== "offer") throw Error("EXPECTED_OFFER");
  const offerId = noted.offerId;
  expect(offerId).toMatch(/^fio_[0-9a-f-]{36}$/);
  const { map, calls } = handlers(ledger, env);
  const metadata = {
    origin: "renderer",
    path: still,
    metadata: { cacheHit: true },
    cacheHit: true,
  };
  await expect(
    map.get("film:confirm-fixed-input")!(true, env.id, offerId, metadata),
  ).resolves.toEqual({
    ok: false,
    code: "UNSUPPORTED_SCOPE",
  });
  expect(calls).toEqual([]);
  const confirmed = await map.get("film:confirm-fixed-input")!(true, env.id, offerId);
  expect(confirmed).toMatchObject({ ok: true });
  if (
    !confirmed ||
    typeof confirmed !== "object" ||
    !("path" in confirmed) ||
    typeof confirmed.path !== "string"
  )
    throw Error("EXPECTED_CONFIRM");
  expect(calls).toEqual(["lineage"]);
  expect(await readFile(confirmed.path)).toEqual(png);
  expect(
    ledger.matches({
      accountSha256: "d".repeat(64),
      projectId: env.id,
      backendProjectId: env.backendProjectId,
      seriesId: env.seriesId,
      role: "still",
      canonicalPath: confirmed.path,
      sha256: createHash("sha256").update(png).digest("hex"),
      mime: "image/png",
      knownAutomaticOutput: false,
    }),
  ).toBe(true);
  expect(
    ledger.matches({
      accountSha256: "d".repeat(64),
      projectId: env.id,
      backendProjectId: env.backendProjectId,
      seriesId: env.seriesId,
      role: "still",
      canonicalPath: confirmed.path,
      sha256: createHash("sha256").update(png).digest("hex"),
      mime: "image/png",
      knownAutomaticOutput: true,
    }),
  ).toBe(false);
  expect(
    await readFile(join(env.filmsRoot, env.seriesId, "episodes", env.id, "project.json")),
  ).toEqual(env.raw);
});

it("imports only a main-picked file and refuses an automatic output without copying it", async () => {
  const ledger = await compiledLedger();
  const env = await project();
  const outside = join(env.filmsRoot, "picked.png");
  await mkdir(env.filmsRoot, { recursive: true });
  await writeFile(outside, png);
  const refused = handlers(ledger, env, { automatic: true, picked: outside });
  await expect(refused.map.get("film:import-fixed-input")!(true, env.id, outside)).resolves.toEqual(
    {
      ok: false,
      code: "UNSUPPORTED_SCOPE",
    },
  );
  expect(refused.calls).toEqual([]);
  await expect(refused.map.get("film:import-fixed-input")!(true, env.id)).resolves.toEqual({
    ok: false,
    code: "UNSUPPORTED_SCOPE",
  });
  expect(refused.calls).toEqual(["pick", "lineage"]);
  const imported = handlers(ledger, env, { picked: outside });
  const made = await imported.map.get("film:import-fixed-input")!(true, env.id);
  expect(made).toMatchObject({ ok: true });
  if (!made || typeof made !== "object" || !("path" in made) || typeof made.path !== "string")
    throw Error("EXPECTED_IMPORT");
  expect(made.path).not.toBe(outside);
  expect(await readFile(made.path)).toEqual(png);
  expect(
    ledger.matches({
      accountSha256: "e".repeat(64),
      projectId: env.id,
      backendProjectId: env.backendProjectId,
      seriesId: env.seriesId,
      role: "still",
      canonicalPath: made.path,
      sha256: createHash("sha256").update(png).digest("hex"),
      mime: "image/png",
      knownAutomaticOutput: false,
    }),
  ).toBe(false);
  expect(
    await readFile(join(env.filmsRoot, env.seriesId, "episodes", env.id, "project.json")),
  ).toEqual(env.raw);
});

it("keeps a cancelled dialog and an unauthorized sender away from the project save queue", async () => {
  const ledger = await compiledLedger();
  const env = await project();
  const opened = handlers(ledger, env, { picked: null });
  await expect(opened.map.get("film:import-fixed-input")!(true, env.id)).resolves.toEqual({
    ok: false,
    code: "CANCELLED",
  });
  await expect(opened.map.get("film:confirm-fixed-input")!(false, env.id, "fio_x")).rejects.toThrow(
    "Unauthorized fixed input sender",
  );
  expect(
    await readFile(join(env.filmsRoot, env.seriesId, "episodes", env.id, "project.json")),
  ).toEqual(env.raw);
});

it("drops a stale scope after the async gate and refuses a full in-memory ledger without persisting it", async () => {
  const ledger = await compiledLedger();
  const env = await project();
  const still = join(env.filmsRoot, env.seriesId, "stills", "manual.png");
  await mkdir(join(env.filmsRoot, env.seriesId, "stills"), { recursive: true });
  await writeFile(still, png);
  const noted = await ledger.noteManualStill(env.filmsRoot, env.seriesId, still);
  if (noted.kind !== "offer") throw Error("EXPECTED_OFFER");
  const account = { bearer: "native-bearer", accountSha256: "d".repeat(64) };
  let live = true;
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  const enteredGate = new Promise<void>((done) => {
    entered = done;
  });
  const map = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerFixedInputHandlers((channel, run) => map.set(channel, run), {
    filmsRoot: () => env.filmsRoot,
    ledger,
    authorized: (event: boolean) => event,
    mediaDispatchLease: async () => ({ account, current: () => live }),
    pickImage: async () => still,
    isAutomaticOutput: async () => {
      entered();
      await hold;
      return false;
    },
  });
  const pending = map.get("film:confirm-fixed-input")!(true, env.id, noted.offerId);
  await enteredGate;
  account.accountSha256 = "e".repeat(64);
  release();
  await expect(pending).resolves.toEqual({ ok: false, code: "UNSUPPORTED_SCOPE" });
  const digest = createHash("sha256").update(png).digest("hex");
  const identity = {
    accountSha256: "d".repeat(64),
    projectId: env.id,
    backendProjectId: env.backendProjectId,
    seriesId: env.seriesId,
    role: "still" as const,
    canonicalPath: still,
    sha256: digest,
    mime: "image/png",
    knownAutomaticOutput: false,
  };
  expect(ledger.matches(identity)).toBe(false);
  account.accountSha256 = "d".repeat(64);
  const projectPath = join(env.filmsRoot, env.seriesId, "episodes", env.id, "project.json");
  for (const change of ["backend", "series", "canonical", "lease"] as const) {
    const again = await ledger.noteManualStill(env.filmsRoot, env.seriesId, still);
    if (again.kind !== "offer") throw Error("EXPECTED_OFFER");
    let open: () => void = () => undefined;
    let mark: () => void = () => undefined;
    const wait = new Promise<void>((done) => {
      open = done;
    });
    const marked = new Promise<void>((done) => {
      mark = done;
    });
    const gate = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    registerFixedInputHandlers((channel, run) => gate.set(channel, run), {
      filmsRoot: () => env.filmsRoot,
      ledger,
      authorized: () => true,
      mediaDispatchLease: async () => ({ account, current: () => live }),
      pickImage: async () => null,
      isAutomaticOutput: async () => {
        mark();
        await wait;
        return false;
      },
    });
    const attempt = gate.get("film:confirm-fixed-input")!(true, env.id, again.offerId);
    await marked;
    const current = JSON.parse((await readFile(projectPath)).toString()) as {
      backendProjectId: string;
      seriesId: string;
      title: string;
    };
    if (change === "backend") current.backendProjectId = `prj_${"d".repeat(32)}`;
    if (change === "series") current.seriesId = `film_${"c".repeat(16)}`;
    if (change === "canonical") current.title = "已经换过的原稿";
    if (change === "lease") live = false;
    if (change !== "lease") await writeFile(projectPath, JSON.stringify(current));
    open();
    await expect(attempt).resolves.toEqual({ ok: false, code: "UNSUPPORTED_SCOPE" });
    if (change !== "lease") await writeFile(projectPath, env.raw);
    live = true;
    expect(ledger.matches(identity)).toBe(false);
  }
  let filled = false;
  for (let index = 0; index < 70 && !filled; index += 1) {
    const extra = await ledger.noteManualStill(env.filmsRoot, env.seriesId, still);
    filled = extra.kind === "full";
  }
  expect(filled).toBe(true);
  expect(await ledger.noteManualStill(env.filmsRoot, env.seriesId, still)).toEqual({
    kind: "full",
  });
  const retry = handlers(ledger, env);
  await expect(
    retry.map.get("film:confirm-fixed-input")!(true, env.id, noted.offerId),
  ).resolves.toMatchObject({
    ok: true,
  });
  const restarted = await compiledLedger();
  expect(restarted.matches(identity)).toBe(false);
});

it("refuses another receipt after 256 and does not seal an import once the canonical project changed", async () => {
  const ledger = await compiledLedger();
  const env = await project();
  const outside = join(env.filmsRoot, "picked.png");
  await mkdir(env.filmsRoot, { recursive: true });
  await writeFile(outside, png);
  const scope = {
    pickedPath: outside,
    accountSha256: "d".repeat(64),
    projectId: env.id,
    backendProjectId: env.backendProjectId,
    seriesId: env.seriesId,
    filmsRoot: env.filmsRoot,
    isAutomaticOutput: async () => false,
  };
  const blocked = await ledger.importPickedFile({
    ...scope,
    stillCurrent: async () => false,
  });
  expect(blocked).toEqual({ ok: false, code: "UNSUPPORTED_SCOPE" });
  let last: { ok: true; path: string } | { ok: false; code: string } = {
    ok: false,
    code: "UNSUPPORTED_SCOPE",
  };
  for (let index = 0; index < 256; index += 1) {
    const made = await ledger.importPickedFile(scope);
    if (!made.ok) throw Error(made.code);
    last = made;
  }
  expect(await ledger.importPickedFile(scope)).toEqual({ ok: false, code: "LEDGER_FULL" });
  if (!last.ok) throw Error("EXPECTED_RECEIPT");
  const restarted = await compiledLedger();
  expect(
    restarted.matches({
      accountSha256: scope.accountSha256,
      projectId: env.id,
      backendProjectId: env.backendProjectId,
      seriesId: env.seriesId,
      role: "still",
      canonicalPath: last.path,
      sha256: createHash("sha256").update(png).digest("hex"),
      mime: "image/png",
      knownAutomaticOutput: false,
    }),
  ).toBe(false);
  expect(await ledger.importPickedFile(scope)).toEqual({ ok: false, code: "LEDGER_FULL" });
});

it.each(["logout", "account"] as const)(
  "does not seal a receipt when the lease changes during the canonical read: %s",
  async (change) => {
    const ledger = await compiledLedger();
    const env = await project();
    const still = join(env.filmsRoot, env.seriesId, "stills", "manual.png");
    await mkdir(join(env.filmsRoot, env.seriesId, "stills"), { recursive: true });
    await writeFile(still, png);
    const noted = await ledger.noteManualStill(env.filmsRoot, env.seriesId, still);
    if (noted.kind !== "offer") throw Error("EXPECTED_OFFER");
    const account = { bearer: "native-bearer", accountSha256: "d".repeat(64) };
    let live = true;
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    const enteredGate = new Promise<void>((done) => {
      entered = done;
    });
    const map = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    let reads = 0;
    registerFixedInputHandlers((channel, run) => map.set(channel, run), {
      filmsRoot: () => env.filmsRoot,
      ledger,
      authorized: () => true,
      mediaDispatchLease: async () => ({ account, current: () => live }),
      pickImage: async () => null,
      readProject: async (root, id) => {
        reads += 1;
        if (reads === 2) {
          entered();
          await hold;
        }
        return readProject(root, id);
      },
      isAutomaticOutput: async () => false,
    });
    const pending = map.get("film:confirm-fixed-input")!(true, env.id, noted.offerId);
    await enteredGate;
    if (change === "logout") live = false;
    else account.accountSha256 = "e".repeat(64);
    release();
    await expect(pending).resolves.toEqual({ ok: false, code: "UNSUPPORTED_SCOPE" });
    live = true;
    account.accountSha256 = "d".repeat(64);
    await expect(
      map.get("film:confirm-fixed-input")!(true, env.id, noted.offerId),
    ).resolves.toMatchObject({ ok: true });
  },
);
