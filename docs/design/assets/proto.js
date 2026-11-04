/* global document, location, URLSearchParams */
// Shared script for the AIVORA prototypes.
// 1. Injects the icon sprite used by <svg class="ic"><use href="#i-name" /></svg>.
// 2. Shows the state named by ?state=. body[data-states] lists the states a page offers;
//    without ?state=, or with a name not in that list, the first one is shown. An element
//    with data-show="a b" is visible only in states a and b.
//    data-disabled="a b" disables a control in states a and b.
// 3. While a dialog is visible, the window behind it is inert, as in the app.

const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  export:
    '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M8 4v16"/><path d="M16 4v16"/>',
  prev: '<path d="M18 5 9 12l9 7z"/><path d="M6 5v14"/>',
  next: '<path d="m6 5 9 7-9 7z"/><path d="M18 5v14"/>',
  loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  wave: '<path d="M2 12h2l2-5 3 10 3-14 3 14 3-10 2 5h2"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3"/>',
  spark:
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  wand: '<path d="m4 20 11-11"/><path d="m15 9 2-2 2 2-2 2z"/><path d="M19 3v3M17.5 4.5h3M10 3v2M9 4h2M20 13v2M19 14h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  volume:
    '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6a8 8 0 0 1 0 12"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  head: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
  upload:
    '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  jump: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  text: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 2-1 3-1a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
};

function injectIcons() {
  const symbols = Object.entries(ICONS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join("");
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`,
  );
}

function applyState() {
  const offered = (document.body.dataset.states || "normal").split(/\s+/).filter(Boolean);
  const asked = new URLSearchParams(location.search).get("state");
  const state = offered.includes(asked) ? asked : offered[0];
  document.body.dataset.state = state;
  for (const node of document.querySelectorAll("[data-show]")) {
    node.hidden = !node.dataset.show.split(/\s+/).includes(state);
  }
  for (const node of document.querySelectorAll("[data-disabled]")) {
    node.disabled = node.dataset.disabled.split(/\s+/).includes(state);
  }
  const dialogOpen = [...document.querySelectorAll(".dialog-back")].some((node) => !node.hidden);
  const app = document.querySelector(".app");
  if (app) app.inert = dialogOpen;
}

injectIcons();
applyState();
