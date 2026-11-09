import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";
import ts from "typescript";
import { registerFixedInputHandlers } from "./film-generation-fixed-input-ipc";
import { writeProject } from "./film-library";
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
  const offerId = await ledger.noteManualStill(env.filmsRoot, env.seriesId, still);
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
