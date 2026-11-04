/** What the host shows in place of a component when project.json has nothing for it. */
export type EmptyState = { title: string; detail: string };

/**
 * The data props for one component, or the empty state to show instead. missing lists the
 * project.json fields that were absent or unusable, as paths such as "shots[2].seconds"; it is
 * for logs and bug reports, not for the screen.
 */
export type Adapted<P> =
  { ok: true; props: P; missing: string[] } | { ok: false; empty: EmptyState; missing: string[] };

export function unreadable(reason: string): Adapted<never> {
  return { ok: false, empty: { title: "作品记录读不出来", detail: reason }, missing: [] };
}
