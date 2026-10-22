import { createServer } from "node:http";
import {
  GROK_CALLBACK_PATH,
  GROK_LOOPBACK_PORT,
  GrokAuthError,
  createGrokAuthorizationAttempt,
} from "./grok-auth-oauth";

/** The system browser is the only recipient of the authorization URL. */
export async function authorizeGrokInBrowser(
  input: { authorizeEndpoint?: string; port?: number },
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal,
): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const server = createServer({
    maxHeaderSize: 8192,
    requestTimeout: 10_000,
    headersTimeout: 10_000,
  });
  let cancel = () => undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", () => reject(new GrokAuthError("CALLBACK_LISTENER_UNAVAILABLE")));
      server.listen(input.port ?? GROK_LOOPBACK_PORT, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new GrokAuthError("CALLBACK_LISTENER_UNAVAILABLE");
    const redirectUri = `http://127.0.0.1:${address.port}${GROK_CALLBACK_PATH}`;
    const attempt = createGrokAuthorizationAttempt({
      redirectUri,
      authorizeEndpoint: input.authorizeEndpoint,
    });
    const result = new Promise<{ code: string }>((resolve, reject) => {
      cancel = () => {
        attempt.cancel();
        reject(
          signal.reason instanceof GrokAuthError
            ? signal.reason
            : new GrokAuthError("AUTH_CANCELLED"),
        );
      };
      signal.addEventListener("abort", cancel, { once: true });
      server.on("request", (request, response) => {
        const host = request.headers.host;
        if (!host || request.url === undefined) {
          response.writeHead(400).end();
          return;
        }
        try {
          const code = attempt.consume(`http://${host}${request.url}`);
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("<p>Grok 登录已回到 AIVORA。可以关闭这个页面。</p>");
          resolve(code);
        } catch (error) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("callback rejected");
          if (error instanceof GrokAuthError && error.code !== "AUTH_STATE_MISMATCH") reject(error);
        }
      });
    });
    await openBrowser(attempt.url);
    const code = await result;
    return { ...code, verifier: attempt.verifier, redirectUri };
  } finally {
    signal.removeEventListener("abort", cancel);
    server.close();
  }
}
