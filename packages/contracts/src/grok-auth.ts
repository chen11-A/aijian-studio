/** Renderer-safe Grok subscription login. Tokens never appear on this surface. */
export type GrokLoginState =
  "NOT_CONNECTED" | "AWAITING_BROWSER" | "CONNECTED" | "ENTITLEMENT_DENIED" | "REAUTH_REQUIRED";

export type GrokLoginStatus = {
  provider: "GROK_LOGIN";
  runtime: "DESKTOP" | "DESKTOP_REQUIRED";
  state: GrokLoginState;
  secureStorage: "AVAILABLE" | "UNAVAILABLE" | "NOT_CHECKED";
  accountLabel: string | null;
  lastError: string | null;
};

export type GrokLoginModel = {
  id: string;
  label: string;
  /** Present when a listing response included output modalities, or when the model came from a media listing. */
  outputModalities?: string[];
};

/** Why a media listing did not add models. HTTP status is for the login log, not the screen. */
export type GrokCatalogNotice = {
  capability: "IMAGE" | "VIDEO" | "SPEECH";
  reason: "denied" | "unavailable" | "none" | "voices";
  httpStatus: number;
};

export type GrokLoginActionResult =
  | { kind: "OK"; status: GrokLoginStatus }
  | { kind: "CANCELLED"; status: GrokLoginStatus }
  | { kind: "ERROR"; code: string; status: GrokLoginStatus };

export type GrokLoginTextResult =
  | { kind: "OK"; text: string; billingAccountKind: "grok_login"; model: string }
  | { kind: "ERROR"; code: string; billingAccountKind: "grok_login" };

export type GrokLoginBridge = {
  status(): Promise<GrokLoginStatus>;
  signIn(): Promise<GrokLoginActionResult>;
  cancel(): Promise<GrokLoginActionResult>;
  signOut(): Promise<GrokLoginActionResult>;
  models(): Promise<
    | { kind: "OK"; models: GrokLoginModel[]; notices?: GrokCatalogNotice[] }
    | { kind: "ERROR"; code: string }
  >;
  completeText(input: {
    model: string;
    text: string;
    projectId?: string;
    idempotencyKey?: string;
  }): Promise<GrokLoginTextResult>;
};
