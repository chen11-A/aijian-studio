import { filmHistoryRecordHash } from "./film-history";
import { readProject as readStoredProject, type FilmRecord } from "./film-library";
import type { GenerationDispatchAccount } from "./generation-dispatch-account";
import type { FixedInputChannelResult, FixedInputLedger } from "./film-generation-fixed-input";

export type FixedInputIpcHost<Event> = {
  filmsRoot: () => string;
  ledger: FixedInputLedger;
  authorized: (event: Event) => boolean;
  mediaDispatchLease: () => Promise<{
    account: GenerationDispatchAccount;
    current: () => boolean;
  } | null>;
  /** Main dialog only. The renderer never supplies this path. */
  pickImage: () => Promise<string | null>;
  /** Test seam for the canonical read. Production uses the real project reader. */
  readProject?: (root: string, id: string) => Promise<FilmRecord | null>;
  /** True when the digest is a known automatic output. Fail closed on uncertainty. */
  isAutomaticOutput: (input: {
    backendProjectId: string;
    sha256: string;
    account: GenerationDispatchAccount;
    current: () => boolean;
  }) => Promise<boolean>;
};

const refused: FixedInputChannelResult = { ok: false, code: "UNSUPPORTED_SCOPE" };
const projectPattern = /^film_[a-z0-9]{16,40}$/;

/** Explicit user choice only. Extra renderer origin/path/metadata/cacheHit arguments are refused. */
export function registerFixedInputHandlers<Event>(
  handle: (channel: string, run: (event: Event, ...args: unknown[]) => Promise<unknown>) => void,
  host: FixedInputIpcHost<Event>,
) {
  handle("film:confirm-fixed-input", async (event, ...args) => {
    if (!host.authorized(event)) throw Error("Unauthorized fixed input sender");
    if (args.length !== 2 || typeof args[0] !== "string" || typeof args[1] !== "string")
      return refused;
    return confirmOrImport(host, event, args[0], async (scope, automatic, stillCurrent) =>
      host.ledger.confirmOffer({
        offerId: args[1] as string,
        ...scope,
        filmsRoot: host.filmsRoot(),
        isAutomaticOutput: automatic,
        stillCurrent,
      }),
    );
  });
  handle("film:import-fixed-input", async (event, ...args) => {
    if (!host.authorized(event)) throw Error("Unauthorized fixed input sender");
    if (args.length !== 1 || typeof args[0] !== "string") return refused;
    return confirmOrImport(host, event, args[0], async (scope, automatic, stillCurrent) => {
      const picked = await host.pickImage();
      if (!picked) return { ok: false, code: "CANCELLED" };
      return host.ledger.importPickedFile({
        pickedPath: picked,
        ...scope,
        filmsRoot: host.filmsRoot(),
        isAutomaticOutput: automatic,
        stillCurrent,
      });
    });
  });
}

async function confirmOrImport<Event>(
  host: FixedInputIpcHost<Event>,
  event: Event,
  rawProjectId: string,
  run: (
    scope: {
      accountSha256: string;
      projectId: string;
      backendProjectId: string;
      seriesId: string;
    },
    isAutomaticOutput: (digest: string) => Promise<boolean>,
    stillCurrent: () => Promise<boolean>,
  ) => Promise<FixedInputChannelResult>,
): Promise<FixedInputChannelResult> {
  if (!host.authorized(event) || !projectPattern.test(rawProjectId)) return refused;
  const lease = await host.mediaDispatchLease();
  if (!lease?.current() || !host.authorized(event)) return refused;
  const read = host.readProject ?? readStoredProject;
  const record = await read(host.filmsRoot(), rawProjectId);
  if (
    !record ||
    record.id !== rawProjectId ||
    typeof record.backendProjectId !== "string" ||
    !/^prj_[a-f0-9]{32}$/.test(record.backendProjectId)
  )
    return refused;
  const backendProjectId = record.backendProjectId;
  const seriesId = record.seriesId;
  const accountSha256 = lease.account.accountSha256;
  const opened = filmHistoryRecordHash(record);
  return run(
    {
      accountSha256,
      projectId: record.id,
      backendProjectId,
      seriesId,
    },
    (digest) =>
      host.isAutomaticOutput({
        backendProjectId,
        sha256: digest,
        account: lease.account,
        current: () => host.authorized(event) && lease.current(),
      }),
    async () => {
      // The live lease predicate is rechecked after the canonical read. A logout
      // or account switch during that await must not seal the scope captured before it.
      const fresh = await read(host.filmsRoot(), rawProjectId);
      if (!host.authorized(event) || !lease.current()) return false;
      if (lease.account.accountSha256 !== accountSha256) return false;
      return (
        fresh?.id === rawProjectId &&
        fresh.backendProjectId === backendProjectId &&
        fresh.seriesId === seriesId &&
        filmHistoryRecordHash(fresh) === opened
      );
    },
  );
}
