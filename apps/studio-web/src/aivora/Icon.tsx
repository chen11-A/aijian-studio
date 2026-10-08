const paths: Record<string, string> = {
  home: "M3 11L12 3L21 11 M5 10V21H10V15H14V21H19V10",
  book: "M5 3H17L21 7V21H5Z M17 3V8H21 M8 12H17 M8 16H16",
  users: "M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 22V19a8 8 0 0 1 16 0V22",
  globe: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M3 12H21 M12 3C6 9 6 15 12 21C18 15 18 9 12 3",
  image: "M3 3H21V21H3Z M3 17L9 11L14 16L17 13L21 17 M7 7H8",
  film: "M3 4H21V20H3Z M7 4V20 M17 4V20 M3 9H7 M3 15H7 M17 9H21 M17 15H21",
  spark: "M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9Z",
  folder: "M3 6H10L12 9H21V21H3Z",
  audio: "M3 9H7L12 4V20L7 15H3Z M16 8Q21 12 16 16",
  review: "M4 3H20V17H10L4 22Z M8 8H16 M8 12H15",
  point:
    "M12 3a7 7 0 0 0-7 7C5 16 12 22 12 22S19 16 19 10a7 7 0 0 0-7-7Z M10 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  range: "M4 4H9 M15 4H20V9 M20 15V20H15 M9 20H4V15 M4 9V4",
  export: "M12 3V15 M7 10L12 15L17 10 M4 16V21H20V16",
  settings:
    "M9 3H15L16 6L20 8L21 12L18 15V19L14 21L11 18H7L3 15L5 11V7Z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  plus: "M12 4v16M4 12h16",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  back: "M15 5L8 12L15 19",
  chevron: "M9 5L16 12L9 19",
  close: "m5 5 14 14M5 19 19 5",
  play: "M7 4L20 12L7 20Z",
  pause: "M8 4v16M16 4v16",
  check: "m4 12 5 5L20 6",
  send: "M3 3L22 12L3 21L6 12Z M6 12H22",
  attach: "M8 13L16 5a4 4 0 0 1 6 6L11 22a6 6 0 0 1-8-8L14 3 M6 16L17 5",
  mic: "M8 4a4 4 0 0 1 8 0V12a4 4 0 0 1-8 0Z M4 10V12a8 8 0 0 0 16 0V10 M12 20V23",
  link: "m9 15 6-6M8 17l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0M16 7l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-6 0",
  clock: "M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0ZM12 6v6l4 3",
  star: "m12 2 3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z",
  search: "M17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0Zm-2 5 7 7",
  menu: "M4 6h16M4 12h16M4 18h16",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  bell: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4M12 2v2",
  expand: "M3 9V3H9 M15 3H21V9 M3 15V21H9 M15 21H21V15",
  edit: "m4 16-1 5 5-1L21 7l-4-4ZM14 6l4 4",
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.spark} />
    </svg>
  );
}
export function Logo() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      <defs>
        <linearGradient id="aivora-logo" x2=".4" y2="1">
          <stop stopColor="#e6a3ff" />
          <stop offset=".55" stopColor="#8a7cff" />
          <stop offset="1" stopColor="#1cc9f3" />
        </linearGradient>
      </defs>
      <g className="v2-logo-mark">
        <path
          d="M22 4Q24 0 28 5L45 37Q49 48 38 42L24 32L10 42Q-1 49 3 37Z"
          fill="none"
          stroke="url(#aivora-logo)"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <path d="M15 29L24 12L33 29L24 23Z" fill="#3eaeef" />
      </g>
    </svg>
  );
}
