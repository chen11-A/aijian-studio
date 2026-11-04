export type BillingProjectCreate = (input: {
  name: string;
  aspect_ratio: "9:16";
  source_language: "zh-CN";
  target_duration_seconds: number;
}) => Promise<{ data?: { id?: unknown } }>;

export function isBillingProjectId(value: unknown): value is string {
  return typeof value === "string" && /^prj_[0-9a-f]{32}$/u.test(value);
}

/** The caller owns binding, cached promises and persistence. Each waiter checks its own identity. */
export async function resolveBillingProject(input: {
  filmId: string;
  name: string;
  pending: Map<string, Promise<string>>;
  isCurrent: () => boolean;
  create: BillingProjectCreate;
}): Promise<string> {
  if (!input.filmId || !input.isCurrent()) return "";
  let pending = input.pending.get(input.filmId);
  if (!pending) {
    // Defer invocation so even synchronous bridge errors share the registered promise.
    const created = Promise.resolve()
      .then(() => {
        if (!input.isCurrent()) throw new Error("BILLING_PROJECT_STALE");
        return input.create({
          name: input.name.slice(0, 80) || "未命名作品",
          aspect_ratio: "9:16",
          source_language: "zh-CN",
          target_duration_seconds: 90,
        });
      })
      .then((response) => {
        const id = response.data?.id;
        if (!isBillingProjectId(id)) throw new Error("BILLING_PROJECT_ID_INVALID");
        return id;
      });
    pending = created.catch(() => {
      if (input.pending.get(input.filmId) === pending) input.pending.delete(input.filmId);
      return "";
    });
    input.pending.set(input.filmId, pending);
  }
  try {
    const id = await pending;
    return input.isCurrent() && isBillingProjectId(id) ? id : "";
  } catch {
    // Also tolerate a rejected promise supplied by a previous host implementation.
    if (input.pending.get(input.filmId) === pending) input.pending.delete(input.filmId);
    return "";
  }
}
