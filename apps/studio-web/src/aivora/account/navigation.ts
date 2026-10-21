/** Ask the studio shell to open a page. Safe when the shell is not mounted. */
export function openAivoraPage(page: string) {
  window.dispatchEvent(new CustomEvent("aivora-open-page", { detail: page }));
}
