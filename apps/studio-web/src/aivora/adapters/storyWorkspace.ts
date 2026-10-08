import type {
  StoryBibleIndexResponse,
  StoryBibleVersionResponse,
  StudioTransport,
} from "../../api/studio";

export type StoryWorkspace = {
  storyBibleIndex: StoryBibleIndexResponse | null;
  storyBibleVersion: StoryBibleVersionResponse | null;
};

export async function loadStoryWorkspace(
  transport: StudioTransport,
  projectId: string,
  acceptedVersionId: string | null,
): Promise<StoryWorkspace> {
  if (!acceptedVersionId) return { storyBibleIndex: null, storyBibleVersion: null };
  const storyBibleIndex = await transport.getStoryBibleIndex(projectId);
  const preferred =
    storyBibleIndex?.data.review_version ??
    storyBibleIndex?.data.accepted_version ??
    storyBibleIndex?.data.latest_version ??
    null;
  return {
    storyBibleIndex,
    storyBibleVersion: preferred
      ? await transport.getStoryBibleVersion(projectId, preferred.id)
      : null,
  };
}
