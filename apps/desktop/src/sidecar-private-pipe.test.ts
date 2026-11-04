/** Controlled owned byte streams; no native host or Windows execution. */
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { createSidecarPrivatePipe, PRIVATE_PIPE_MAX_LINE } from "./sidecar-private-pipe";

function setup(timeoutMs = 1000, pid = 1234) {
  const stdin = new PassThrough(),
    stdout = new PassThrough();
  const writes: Record<string, unknown>[] = [];
  stdin.on("data", (data: Buffer) => {
    writes.push(JSON.parse(data.toString()));
  });
  const channel = createSidecarPrivatePipe({
    stdin,
    stdout,
    childPid: () => pid,
    parentPid: 4321,
    timeoutMs,
  });
  const emit = (value: unknown) => stdout.write(JSON.stringify(value) + "\n");
  const handshake = (peerPid = pid) =>
    emit({
      event: "ready",
      host: "127.0.0.1",
      pid: peerPid,
      port: 45000,
      protocol_version: 1,
      token: "a".repeat(43),
    });
  const respond = (result: unknown, id = writes.at(-1)!.request_id) =>
    emit({
      event: "aivora_native_reply",
      peer_pid: pid,
      request_id: id,
      result,
    });
  return { ...channel, stdin, stdout, writes, emit, handshake, respond };
}
afterEach(() => {
  vi.useRealTimers();
});
it("binds the handshake to the actual spawned child PID", async () => {
  const test = setup();
  test.handshake(5678);
  await expect(test.ready).rejects.toThrow("unavailable");
  expect(test.stdin.writableEnded).toBe(true);
  expect(await test.pipe.request("prepare", {})).toEqual({ kind: "UNKNOWN" });
  expect(test.writes).toHaveLength(0);
});
it("bounds handshake bytes before a newline", async () => {
  const test = setup();
  test.stdout.write("a".repeat(4097));
  await expect(test.ready).rejects.toThrow();
  expect(test.stdin.writableEnded).toBe(true);
});
it("queues independent original requests without sending them concurrently", async () => {
  const test = setup();
  test.handshake();
  await test.ready;
  const first = test.pipe.request("read", { lease_id: "A" });
  const second = test.pipe.request("read", { lease_id: "B" });
  await vi.waitFor(() => expect(test.writes).toHaveLength(1));
  expect(test.writes[0]).toMatchObject({ peer_pid: 1234, parent_pid: 4321, operation: "read" });
  test.respond({ kind: "OK", value: { source: "A" } });
  expect(await first).toEqual({ kind: "OK", value: { source: "A" } });
  await vi.waitFor(() => expect(test.writes).toHaveLength(2));
  expect(test.writes[1]!.request_id).not.toBe(test.writes[0]!.request_id);
  test.respond({ kind: "OK", value: { source: "B" } });
  expect(await second).toEqual({ kind: "OK", value: { source: "B" } });
  test.pipe.close();
});
it.each(["wrong-id", "wrong-peer", "extra", "duplicate", "invalid-utf8", "oversized"])(
  "poisons unknown receipts and never resends or sends queued mutation: %s",
  async (fault) => {
    const test = setup();
    test.handshake();
    await test.ready;
    const first = test.pipe.request("launch", {}),
      queued = test.pipe.request("write", {});
    await vi.waitFor(() => expect(test.writes).toHaveLength(1));
    if (fault === "wrong-id") test.respond({ kind: "OK", value: {} }, "npr_" + "f".repeat(32));
    if (fault === "wrong-peer")
      test.emit({
        event: "aivora_native_reply",
        peer_pid: 5678,
        request_id: test.writes[0]!.request_id,
        result: { kind: "OK", value: {} },
      });
    if (fault === "extra") test.respond({ kind: "OK", value: {}, unexpected: true });
    if (fault === "duplicate")
      test.stdout.write(
        `{"event":"aivora_native_reply","peer_pid":1234,"peer_pid":1234,"request_id":"${String(test.writes[0]!.request_id)}","result":{"kind":"OK","value":{}}}\n`,
      );
    if (fault === "invalid-utf8") test.stdout.write(Buffer.from([0xff, 10]));
    if (fault === "oversized") test.stdout.write("a".repeat(PRIVATE_PIPE_MAX_LINE + 1));
    expect(await first).toEqual({ kind: "UNKNOWN" });
    expect(await queued).toEqual({ kind: "UNKNOWN" });
    expect(await test.pipe.request("launch", {})).toEqual({ kind: "UNKNOWN" });
    expect(test.writes).toHaveLength(1);
    expect(test.stdin.writableEnded).toBe(true);
  },
);
it("times out once and retains the original unknown without automatic replay", async () => {
  vi.useFakeTimers();
  const test = setup(10);
  test.handshake();
  await test.ready;
  const result = test.pipe.request("launch", {});
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toEqual({ kind: "UNKNOWN" });
  expect(test.writes).toHaveLength(1);
  test.respond({ kind: "OK", value: {} });
  expect(test.writes).toHaveLength(1);
});
it("rejects a native event without a unique registered original lease", async () => {
  const test = setup();
  test.handshake();
  await test.ready;
  const failed = vi.fn();
  test.pipe.onFailure(failed);
  test.pipe.onStream(() => false);
  test.emit({
    event: "aivora_native_stream",
    peer_pid: 1234,
    lease_id: "npl_" + "a".repeat(32),
    sequence: 1,
    stream: "exit",
    bytes: "",
  });
  expect(failed).toHaveBeenCalledOnce();
  expect(test.stdin.writableEnded).toBe(true);
});

it("rejects duplicate startup identity fields before admitting the owned pipe", async () => {
  const stdin = new PassThrough(),
    stdout = new PassThrough();
  const transport = createSidecarPrivatePipe({ stdin, stdout, childPid: () => 1234 });
  const ready = expect(transport.ready).rejects.toThrow();
  stdout.write(
    '{"event":"ready","host":"127.0.0.1","pid":99,"pid":1234,"port":43123,"protocol_version":1,"token":"' +
      "s".repeat(43) +
      '"}\n',
  );
  await ready;
  expect(await transport.pipe.request("stop", {})).toEqual({ kind: "UNKNOWN" });
});
