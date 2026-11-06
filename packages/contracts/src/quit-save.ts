/** Narrow lifecycle handshake. No project content, local paths or raw write errors cross it. */
export type FilmFlushRequest = { requestId: string };
export type FilmFlushStatus = "saved" | "failed" | "busy" | "unknown";
export type FilmFlushAck = FilmFlushRequest & { status: FilmFlushStatus };
export type QuitSaveGateway = {
  onFlush: (handler: (request: FilmFlushRequest) => void) => () => void;
  flushed: (ack: FilmFlushAck) => Promise<void>;
};
