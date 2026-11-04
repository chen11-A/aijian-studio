/** Fixed by Vite at build time; never inferred from runtime media availability. */
declare const __AIVORA_BUILD_PROFILE__: "production" | "development-core";

export function isDevelopmentCoreBuild(): boolean {
  return (
    typeof __AIVORA_BUILD_PROFILE__ !== "undefined" &&
    __AIVORA_BUILD_PROFILE__ === "development-core"
  );
}

export const DEVELOPMENT_CORE_MEDIA_NOTICE =
  "DEVELOPMENT_CORE 开发核心版未附带 FFmpeg、FFprobe 或 MLT 媒体工具；本包不提供草稿 MP4 编码或连续预览生成。已验证的历史输出仍可查看。";
