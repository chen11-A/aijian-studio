import type { MltNativeReleaseProfile } from "./media-preview-native-wire";
import type { MltPeClosureReceipt } from "./media-preview-pe-admission";

/** Only a reviewed application release may change this compiled policy.
 * No disk manifest, environment variable, settings, renderer or IPC can admit a profile.
 * Empty until real binary/license/source/Windows receipts have been reviewed.
 */
export type InstalledMltPolicy = Readonly<{
  profile: MltNativeReleaseProfile;
  peReceipt: MltPeClosureReceipt;
  systemDlls: readonly string[];
}>;
export const ADMITTED_INSTALLED_MLT: readonly InstalledMltPolicy[] = Object.freeze([]);
