import type { FilmImageModelSelection } from "@aijian/contracts/film-generation-execution";
import { IMAGE_MODEL } from "./film-library";

/** No generic destination, credential or provider fallback. This exact selection
 * serializes the unchanged production image request. Callers retain the legacy
 * path only when the optional choice is absent, never for malformed input. */
export function supportedFilmImageSelection(raw: unknown): raw is FilmImageModelSelection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const choice = raw as Record<string, unknown>;
  return (
    Object.keys(choice).length === 2 &&
    Object.hasOwn(choice, "provider") &&
    Object.hasOwn(choice, "modelId") &&
    choice.provider === "GROK_LOGIN" &&
    choice.modelId === IMAGE_MODEL
  );
}
