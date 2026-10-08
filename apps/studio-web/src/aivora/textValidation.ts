/** Match C0 controls and DEL, optionally allowing only LF for multiline text. */
export function hasAsciiControlCharacter(value: string, allowLineFeed = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code <= 0x1f || code === 0x7f) && !(allowLineFeed && code === 0x0a)) {
      return true;
    }
  }
  return false;
}
