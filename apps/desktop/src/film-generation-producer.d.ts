/** Implemented by the fixed, source-receipted build entry, never by a source fallback. */
export function storyFilmBatches(film: unknown, shots: unknown[], draft: boolean): unknown[];
export function generationVideoBody(
  film: unknown,
  target: unknown,
  original: unknown,
  firstNewTakeId: string | undefined,
  draft: boolean,
): unknown;
export function keyframePrompt(shot: unknown, film: unknown): string;
export function portraitPrompts(...args: unknown[]): unknown;
export function sceneLocation(film: unknown, sceneId: string): unknown;
export function sceneLocationTargets(film: unknown): unknown[];
export function locationImageCurrent(film: unknown, location: unknown): boolean;
export function locationGenerationPrompt(film: unknown, location: unknown): string;
export function prepareSceneLocations(film: unknown, sceneIds?: readonly string[]): unknown;
export function shotLocation(film: unknown, shot: unknown): unknown;
export function shotStillInput(film: unknown, shot: unknown, prompt: string): unknown;
export function shotReference(shot: unknown, film: unknown): unknown;
export function withStyleBible(prompt: string, style: string, maxLength?: number): string;
export function withIdentityLocks(...args: unknown[]): unknown;
