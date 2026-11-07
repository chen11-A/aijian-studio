/** Single-source native producer entry. Build a closed, pure runtime from the same
 * functions consumed by the editor; never reconstruct a second prompt algorithm. */
export { storyFilmBatches, shotReference, portraitPrompts } from "../../../apps/studio-web/src/aivora/film/operations";
export { keyframePrompt } from "../../../apps/studio-web/src/aivora/film/project";
export { withStyleBible } from "../../../apps/studio-web/src/aivora/film/style-bible";
export { withIdentityLocks } from "../../../apps/studio-web/src/aivora/film/phase2";
export { generationVideoBody } from "../../../apps/studio-web/src/aivora/pro/actions/video-prompt-review";
export { shotStillInput } from "../../../apps/studio-web/src/aivora/film/shot-still-input";
export {
  prepareSceneLocations,
  sceneLocation,
  shotLocation,
  sceneLocationTargets,
  locationImageCurrent,
  locationGenerationPrompt,
} from "../../../apps/studio-web/src/aivora/film/location-reference";
