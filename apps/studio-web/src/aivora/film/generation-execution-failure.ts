/** Renderer-local control flow only. Never serialized as provider evidence or portable authority. */
export class ProtectedGenerationFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProtectedGenerationFailure";
  }
}
