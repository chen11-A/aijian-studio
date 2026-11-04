/** Escape an unquoted AVOption value through both FFmpeg filter parsing layers.
 * The result is for execFile's -vf argument, never a shell command.
 * Preserve backslashes (including Windows drive/UNC paths) rather than normalizing.
 */
export function escapeFilterPath(value) {
  if (typeof value !== "string" || !value || /[\0\r\n]/.test(value))
    throw new Error("滤镜路径无效");
  const option = value.replace(/[\\':\s]/gu, "\\$&");
  return option.replace(/[\\'[\],;\s]/gu, "\\$&");
}
