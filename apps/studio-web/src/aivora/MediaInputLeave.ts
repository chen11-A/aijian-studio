/** First preserve every original intent; ask about dirty inputs only after all permit leaving. */
export type MediaInputLeave = { preserve: () => boolean; dirty: () => boolean };
