import { createServer } from "node:http";
import { ChatGPTError, createAuthorizationAttempt, CALLBACK_PATH } from "./chatgpt-auth-oauth";

/** Only the system browser receives the authorization URL. Never send it through renderer IPC. */
export async function authorizeInBrowser(
  input: {
    hostId: string;
    clientId?: string;
    idTokenHint?: string;
  },
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal,
) {
  const server = createServer({
    maxHeaderSize: 8192,
    requestTimeout: 10_000,
    headersTimeout: 10_000,
  });
  let abort = () => undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", () => reject(new ChatGPTError("CALLBACK_LISTENER_UNAVAILABLE")));
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new ChatGPTError("CALLBACK_LISTENER_UNAVAILABLE");
    const origin = `http://127.0.0.1:${address.port}`;
    const attempt = createAuthorizationAttempt({
      ...input,
      redirectUri: `${origin}${CALLBACK_PATH}`,
    });
    const result = new Promise<ReturnType<typeof attempt.consume>>((resolve, reject) => {
      abort = () => {
        attempt.cancel();
        reject(
          signal.reason instanceof ChatGPTError
            ? signal.reason
            : new ChatGPTError("AUTH_CANCELLED"),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      server.on("request", (request, response) => {
        response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        if (
          request.method !== "GET" ||
          request.headers.host !== `127.0.0.1:${address.port}` ||
          !request.url?.startsWith(`${CALLBACK_PATH}?`) ||
          request.url.length > 16_384
        ) {
          response.writeHead(400);
          response.end("Invalid callback.");
          return;
        }
        try {
          const value = attempt.consume(`${origin}${request.url}`);
          response.end(
            "Return to AIVORA to finish verifying your connection. You can close this tab.",
          );
          resolve(value);
        } catch (error) {
          response.writeHead(400);
          response.end("The sign-in callback could not be accepted. Return to AIVORA.");
          if (
            error instanceof ChatGPTError &&
            !["AUTH_STATE_MISMATCH", "CALLBACK_REJECTED"].includes(error.code)
          )
            reject(error);
        }
      });
      void openBrowser(attempt.url).catch(() => reject(new ChatGPTError("BROWSER_OPEN_FAILED")));
    });
    return await result;
  } finally {
    signal.removeEventListener("abort", abort);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
