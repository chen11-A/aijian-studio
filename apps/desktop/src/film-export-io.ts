import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { finished, pipeline } from "node:stream/promises";
/** Abort closes file descriptors before the tracked promise settles. */
export async function exportFileHash(path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const hash = createHash("sha256"),
    stream = createReadStream(path, { signal });
  try {
    for await (const chunk of stream) hash.update(chunk);
    signal?.throwIfAborted();
    return hash.digest("hex");
  } finally {
    await finished(stream).catch(() => undefined);
  }
}
export async function copyExportFile(source: string, destination: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await pipeline(createReadStream(source), createWriteStream(destination, { flags: "wx" }), {
    signal,
  });
  signal?.throwIfAborted();
}
