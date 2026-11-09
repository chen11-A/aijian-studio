import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep } from "node:path";

/** Desktop-local offer/receipt channel. Not a shared PREPARED protocol field. */
export type FixedInputChannelResult =
  { ok: true; path: string } | { ok: false; code: "UNSUPPORTED_SCOPE" | "CANCELLED" };

export type FixedInputMime = "image/png" | "image/jpeg" | "image/webp";
export type FixedInputRole = "still";

export type FixedInputMatch = {
  accountSha256: string;
  projectId: string;
  backendProjectId: string;
  seriesId: string;
  role: FixedInputRole;
  canonicalPath: string;
  sha256: string;
  mime: string;
  /** Known automatic outputs stay on the restore path and never match a fixed input. */
  knownAutomaticOutput: boolean;
};

type Receipt = {
  accountSha256: string;
  projectId: string;
  backendProjectId: string;
  seriesId: string;
  role: FixedInputRole;
  canonicalPath: string;
  sha256: string;
  mime: FixedInputMime;
};

type Offer = {
  id: string;
  seriesId: string;
  canonicalPath: string;
  sha256: string;
  mime: FixedInputMime;
};

const refuse = (): FixedInputChannelResult => ({ ok: false, code: "UNSUPPORTED_SCOPE" });
const projectId = (value: string) => /^film_[a-z0-9]{16,40}$/.test(value);
const backendId = (value: string) => /^prj_[a-f0-9]{32}$/.test(value);
const accountId = (value: string) => /^[a-f0-9]{64}$/.test(value);
const offerId = (value: string) => /^fio_[0-9a-f-]{36}$/.test(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const maxBytes = 12_000_000;

function sniff(bytes: Uint8Array): FixedInputMime | null {
  if (bytes.byteLength < 8 || bytes.byteLength > maxBytes) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  const riff = Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF";
  const webp = Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  return riff && webp ? "image/webp" : null;
}

const extensionMime = new Map<string, FixedInputMime>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function inside(root: string, file: string): boolean {
  const value = relative(root, file);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

async function stillsRoot(filmsRoot: string, seriesId: string): Promise<string | null> {
  if (!projectId(seriesId)) return null;
  return realpath(join(filmsRoot, seriesId, "stills")).catch(() => null);
}

function receiptKey(receipt: Receipt): string {
  return [
    receipt.accountSha256,
    receipt.projectId,
    receipt.backendProjectId,
    receipt.seriesId,
    receipt.role,
    receipt.canonicalPath,
  ].join("\0");
}

/** Main-private fixed-input proofs. Directory membership never creates one. */
export function createFixedInputLedger() {
  const offers = new Map<string, Offer>();
  const receipts = new Map<string, Receipt>();

  async function readCanonical(
    filmsRoot: string,
    seriesId: string,
    filePath: string,
  ): Promise<{ path: string; sha256: string; mime: FixedInputMime } | null> {
    const root = await stillsRoot(filmsRoot, seriesId);
    if (!root) return null;
    let canonical: string;
    try {
      canonical = await realpath(filePath);
    } catch {
      return null;
    }
    if (!inside(root, canonical)) return null;
    const mime = extensionMime.get(extname(canonical).toLowerCase());
    if (!mime) return null;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(canonical);
    } catch {
      return null;
    }
    const sniffed = sniff(bytes);
    if (!sniffed || sniffed !== mime) return null;
    return { path: canonical, sha256: sha256(bytes), mime };
  }

  return {
    /** Record the file this process just wrote. The offer is not a receipt. */
    async noteManualStill(
      filmsRoot: string,
      seriesId: string,
      filePath: string,
    ): Promise<string | null> {
      if (offers.size >= 64) return null;
      const image = await readCanonical(filmsRoot, seriesId, filePath);
      if (!image) return null;
      const id = `fio_${randomUUID()}`;
      offers.set(id, {
        id,
        seriesId,
        canonicalPath: image.path,
        sha256: image.sha256,
        mime: image.mime,
      });
      return id;
    },
    async confirmOffer(input: {
      offerId: string;
      accountSha256: string;
      projectId: string;
      backendProjectId: string;
      seriesId: string;
      filmsRoot: string;
      isAutomaticOutput: (digest: string) => Promise<boolean>;
    }): Promise<FixedInputChannelResult> {
      if (
        !offerId(input.offerId) ||
        !accountId(input.accountSha256) ||
        !projectId(input.projectId) ||
        !backendId(input.backendProjectId) ||
        !projectId(input.seriesId) ||
        receipts.size >= 256
      )
        return refuse();
      const offer = offers.get(input.offerId);
      if (!offer || offer.seriesId !== input.seriesId) return refuse();
      const image = await readCanonical(input.filmsRoot, input.seriesId, offer.canonicalPath);
      if (
        !image ||
        image.sha256 !== offer.sha256 ||
        image.mime !== offer.mime ||
        image.path !== offer.canonicalPath
      )
        return refuse();
      let automatic = true;
      try {
        automatic = await input.isAutomaticOutput(image.sha256);
      } catch {
        automatic = true;
      }
      if (automatic) return refuse();
      offers.delete(offer.id);
      const receipt: Receipt = {
        accountSha256: input.accountSha256,
        projectId: input.projectId,
        backendProjectId: input.backendProjectId,
        seriesId: input.seriesId,
        role: "still",
        canonicalPath: image.path,
        sha256: image.sha256,
        mime: image.mime,
      };
      receipts.set(receiptKey(receipt), receipt);
      return { ok: true, path: image.path };
    },
    async importPickedFile(input: {
      pickedPath: string;
      accountSha256: string;
      projectId: string;
      backendProjectId: string;
      seriesId: string;
      filmsRoot: string;
      isAutomaticOutput: (digest: string) => Promise<boolean>;
    }): Promise<FixedInputChannelResult> {
      if (
        !input.pickedPath ||
        input.pickedPath.includes("\0") ||
        !accountId(input.accountSha256) ||
        !projectId(input.projectId) ||
        !backendId(input.backendProjectId) ||
        !projectId(input.seriesId) ||
        receipts.size >= 256
      )
        return refuse();
      let source: string;
      try {
        source = await realpath(input.pickedPath);
      } catch {
        return refuse();
      }
      let bytes: Uint8Array;
      try {
        bytes = await readFile(source);
      } catch {
        return refuse();
      }
      const mime = sniff(bytes);
      if (!mime) return refuse();
      const digest = sha256(bytes);
      let automatic = true;
      try {
        automatic = await input.isAutomaticOutput(digest);
      } catch {
        automatic = true;
      }
      if (automatic) return refuse();
      const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png";
      const directory = join(input.filmsRoot, input.seriesId, "stills");
      const destination = join(directory, `${randomBytes(8).toString("hex")}${extension}`);
      await mkdir(directory, { recursive: true });
      await writeFile(destination, bytes);
      const image = await readCanonical(input.filmsRoot, input.seriesId, destination);
      if (!image || image.sha256 !== digest || image.mime !== mime) return refuse();
      const receipt: Receipt = {
        accountSha256: input.accountSha256,
        projectId: input.projectId,
        backendProjectId: input.backendProjectId,
        seriesId: input.seriesId,
        role: "still",
        canonicalPath: image.path,
        sha256: image.sha256,
        mime: image.mime,
      };
      receipts.set(receiptKey(receipt), receipt);
      return { ok: true, path: image.path };
    },
    matches(input: FixedInputMatch): boolean {
      if (input.knownAutomaticOutput || input.role !== "still") return false;
      if (
        !accountId(input.accountSha256) ||
        !projectId(input.projectId) ||
        !backendId(input.backendProjectId) ||
        !projectId(input.seriesId) ||
        !/^[a-f0-9]{64}$/.test(input.sha256)
      )
        return false;
      const receipt = receipts.get(
        receiptKey({
          accountSha256: input.accountSha256,
          projectId: input.projectId,
          backendProjectId: input.backendProjectId,
          seriesId: input.seriesId,
          role: "still",
          canonicalPath: input.canonicalPath,
          sha256: input.sha256,
          mime: input.mime as FixedInputMime,
        }),
      );
      return (
        receipt?.sha256 === input.sha256 &&
        receipt.mime === input.mime &&
        receipt.canonicalPath === input.canonicalPath
      );
    },
  };
}

export type FixedInputLedger = ReturnType<typeof createFixedInputLedger>;
