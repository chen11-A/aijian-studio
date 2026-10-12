/** A finite project metadata declaration; consumer and Gate capabilities remain separate. */
export type ProjectAspectRatio = "16:9" | "9:16";

export function isProjectAspectRatio(value: unknown): value is ProjectAspectRatio {
  return value === "16:9" || value === "9:16";
}
