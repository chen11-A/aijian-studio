/** Local development preview of the desktop renderer, backed by the real sidecar.
 * Native dialogs, credentials, remote AI and media execution are deliberately absent.
 * Never bind this developer-only helper to a network interface.
 */
import { createServer, request as httpRequest } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import sidecarModule from "../apps/desktop/dist/sidecar-process.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = await realpath(join(root, "apps/studio-web/dist"));
const port = Number(process.env.AIVORA_PREVIEW_PORT || 5173);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("AIVORA_PREVIEW_PORT must be an unprivileged local port.");
}
const host = `127.0.0.1:${port}`;
const origin = `http://${host}`;
const dataDirectory = resolve(root, ".aijian-dev/preview-workspace");
await mkdir(dataDirectory, { recursive: true });
const sidecar = await sidecarModule.startSidecar({
  command: join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
  args: ["-m", "aijian_api.sidecar"],
  cwd: root,
  env: {
    AIJIAN_DATA_DIR: dataDirectory,
    AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME: "0",
    PYTHONPATH: join(root, "services/api/src"),
  },
});

const project = "/api/v1/projects/prj_[0-9a-f]{32}";
const episode = `${project}/episodes/ep_(?:prj_)?[0-9a-f]{32}`;
const safeRead = new RegExp(`^(?:/api/v1/(?:health|projects|provider-connections)|${project}(?:/(?:episodes(?:/ep_(?:prj_)?[0-9a-f]{32})?|sources(?:/src_[0-9a-f]{32}(?:/text)?)?|source-manifest|story-bible(?:/versions/[^/]+)?|production-brief(?:/versions/[^/]+)?|source-extraction(?:/versions/[^/]+(?:/proposal-acceptance)?)?|tasks|agents|skills|timeline|invalidation-operations(?:/[^/]+)?))?|${episode}/script(?:/versions/[^/]+|/confirmation(?:/[^/]+)?)?)$`);
const safeCreate = new RegExp(`^(?:/api/v1/projects|${project}/(?:episodes|sources|production-brief/versions)|${episode}/script/versions)$`);
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
};
function fail(response, status, code, message) {
  if (response.headersSent) { response.destroy(); return; }
  const requestId = randomUUID();
  response.writeHead(status, { "Content-Type": "application/json", "X-Request-ID": requestId });
  response.end(JSON.stringify({ error: { code, message, request_id: requestId } }));
}
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (request.headers.host !== host ||
      (request.headers.origin && request.headers.origin !== origin) ||
      request.headers["sec-fetch-site"] === "cross-site") {
    fail(response, 403, "PREVIEW_ORIGIN_REJECTED", "Only this local renderer may access the preview.");
    return;
  }
  try {
    const url = new URL(request.url || "/", origin);
    if (url.origin !== origin || /%(?:2f|5c|00)/i.test(url.pathname)) {
      fail(response, 400, "PREVIEW_PATH_REJECTED", "Invalid preview path.");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const read = request.method === "GET" && safeRead.test(url.pathname);
      const create = request.method === "POST" && safeCreate.test(url.pathname);
      const update = request.method === "PATCH" && new RegExp(`^${project}$`).test(url.pathname);
      if (!read && !create && !update) {
        fail(response, 403, "PREVIEW_NATIVE_REQUIRED", "This operation requires the desktop app. The local preview only edits projects, sources, briefs and scripts.");
        return;
      }
      if (!read && (request.headers.origin !== origin || !request.headers["content-type"]?.startsWith("application/json"))) {
        fail(response, 403, "PREVIEW_ORIGIN_REJECTED", "Writes require same-origin JSON requests.");
        return;
      }
      const headers = { Authorization: `Bearer ${sidecar.session.token}`, Origin: "app://aijian", Accept: "application/json" };
      for (const name of ["content-type", "content-length", "if-match", "idempotency-key"]) {
        if (request.headers[name]) headers[name] = request.headers[name];
      }
      const upstream = httpRequest(`${sidecar.session.origin}${url.pathname}${url.search}`, {
        method: request.method, headers, timeout: 30_000,
      }, (result) => {
        for (const name of ["content-type", "x-request-id", "etag"]) {
          if (result.headers[name]) response.setHeader(name, result.headers[name]);
        }
        response.writeHead(result.statusCode || 502);
        result.pipe(response);
      });
      upstream.on("timeout", () => upstream.destroy(new Error("Local API timeout")));
      upstream.on("error", () => fail(response, 502, "PREVIEW_SIDECAR_UNAVAILABLE", "Local API response unavailable; do not repeat an unknown write without checking saved data."));
      request.on("aborted", () => upstream.destroy());
      request.pipe(upstream);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      fail(response, 405, "PREVIEW_METHOD_REJECTED", "Unsupported method.");
      return;
    }
    const path = await realpath(join(webRoot, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
    if (!path.startsWith(webRoot + sep) || !(await stat(path)).isFile()) {
      fail(response, 404, "PREVIEW_FILE_NOT_FOUND", "Preview file unavailable.");
      return;
    }
    response.setHeader("Content-Type", mimeTypes[extname(path)] || "application/octet-stream");
    if (request.method === "HEAD") response.end();
    else createReadStream(path).pipe(response);
  } catch {
    fail(response, 404, "PREVIEW_FILE_NOT_FOUND", "Preview file unavailable.");
  }
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  server.close();
  try { await sidecar.stop(); } catch { code = 1; }
  process.exitCode = code;
}
server.on("error", async (error) => {
  console.error(`Preview could not start: ${error.message}`);
  await stop(1);
});
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
void sidecar.exited.then(() => { if (!stopping) void stop(1); });
server.listen(port, "127.0.0.1", () => {
  console.log(`AIVORA local renderer preview: ${origin}/#launch`);
  console.log("Real local persistence; native desktop, AI calls, credentials and media execution are not available in this preview.");
  console.log(`Workspace: ${dataDirectory}`);
  console.log("Press Ctrl+C to stop both preview and sidecar. Saved data remains for the next launch.");
});
