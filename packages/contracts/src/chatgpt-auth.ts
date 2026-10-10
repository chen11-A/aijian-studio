/** Renderer-safe official SIWC contract. No credential fields belong in this surface. */
export type ChatGPTUseScope = "LOCAL_PERSONAL" | "OPEN_SOURCE" | "APPROVED_PRIVATE";
export type ChatGPTProfileSummary = {
  id: string;
  label: string;
  email: string | null;
  connected: boolean;
  planUsage: boolean;
};
export type ChatGPTStatus = {
  provider: "CHATGPT_OFFICIAL";
  runtime: "DESKTOP" | "DESKTOP_REQUIRED";
  state: "NOT_CONNECTED" | "AWAITING_BROWSER" | "CONNECTED" | "IDENTITY_ONLY" | "REAUTH_REQUIRED";
  useScope: ChatGPTUseScope | null;
  secureStorage: "AVAILABLE" | "UNAVAILABLE" | "NOT_CHECKED";
  activeProfileId: string | null;
  profiles: ChatGPTProfileSummary[];
  lastError: string | null;
  liveVerified: boolean;
};
export type ChatGPTModel = { slug: string; displayName: string };
export type ChatGPTActionResult =
  | { kind: "OK"; status: ChatGPTStatus }
  | { kind: "CANCELLED"; status: ChatGPTStatus }
  | { kind: "ERROR"; code: string; status: ChatGPTStatus };
export type ChatGPTBridge = {
  openHelp?(topic: "documentation" | "usage" | "eligibility"): Promise<void>;
  status(): Promise<ChatGPTStatus>;
  signIn(scope: ChatGPTUseScope, profileId?: string | null): Promise<ChatGPTActionResult>;
  cancel(): Promise<ChatGPTActionResult>;
  selectProfile(profileId: string): Promise<ChatGPTActionResult>;
  signOut(): Promise<ChatGPTActionResult>;
  models(): Promise<
    { kind: "OK"; models: ChatGPTModel[]; profileId?: string } | { kind: "ERROR"; code: string }
  >;
};
