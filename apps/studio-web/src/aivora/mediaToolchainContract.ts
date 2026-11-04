/** Renderer-safe status only. Paths and executable admission are owned by native code. */
export type MediaToolchainStatus = {
  schema_version: 1;
  state: "AVAILABLE" | "NOT_CONFIGURED" | "INVALID" | "UNSUPPORTED";
  source: "EXTERNAL" | "BUNDLED" | "DEVELOPMENT_OVERRIDE" | "DEVELOPMENT_LOCAL" | "NONE";
  profile_id: string | null;
  version: string | null;
  directory: string | null;
  diagnostic: string;
  can_probe: boolean;
  can_preview: boolean;
  can_draft_export: boolean;
  formal_release_approved: false;
};
export type MediaToolchainReadResult =
  { kind: "STATUS"; status: MediaToolchainStatus } | { kind: "REMOTE_UNKNOWN" };
export type MediaToolchainSelectResult =
  MediaToolchainReadResult | { kind: "PICKER_CANCELLED" | "PICKER_BUSY" };
export type MediaToolchainCancelResult = {
  kind: "CANCELLED" | "NO_PENDING_SELECTION" | "ALREADY_SUBMITTED";
};
export interface MediaToolchainGateway {
  cancelMediaToolchainSelection?(): Promise<MediaToolchainCancelResult>;
  getMediaToolchainStatus(): Promise<MediaToolchainReadResult>;
  selectMediaToolchain(): Promise<MediaToolchainSelectResult>;
  clearMediaToolchain(): Promise<MediaToolchainReadResult>;
}
export const EXTERNAL_MEDIA_PROFILE = "windows-x86_64-gyan-full-8.1.2-dev";
export const EXTERNAL_MEDIA_VERSION = "8.1.2";
export const EXTERNAL_MEDIA_HASHES = {
  ffmpeg: "ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e",
  ffprobe: "9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015",
} as const;
