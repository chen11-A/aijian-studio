export function canonicalLoopbackOrigin(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Local API URL must be a canonical loopback origin");
  }

  const isCanonical =
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";
  if (!isCanonical || url.origin !== baseUrl) {
    throw new Error("Local API URL must be a canonical loopback origin");
  }
  return url.origin;
}
