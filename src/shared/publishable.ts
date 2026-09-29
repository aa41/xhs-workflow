export const PUBLISHABLE_START = "<!-- PUBLISHABLE_MARKDOWN_START -->";
export const PUBLISHABLE_END = "<!-- PUBLISHABLE_MARKDOWN_END -->";

export function cleanPublishableMarkdown(markdown: string): string {
  return markdown.replace(/[【\[]\s*[a-f0-9]{7,40}\s*[】\]]/gi, "")
    .replace(/\b[a-f0-9]{40}\b/gi, "")
    .replace(/[ \t]+(?=\n)/g, "").trim();
}

export function extractPublishableMarkdown(draft: string): string | null {
  const start = draft.indexOf(PUBLISHABLE_START);
  const end = draft.indexOf(PUBLISHABLE_END);
  if (start < 0 || end < start + PUBLISHABLE_START.length ||
    draft.indexOf(PUBLISHABLE_START, start + 1) !== -1 || draft.indexOf(PUBLISHABLE_END, end + 1) !== -1) return null;
  const markdown = draft.slice(start + PUBLISHABLE_START.length, end).trim();
  const clean = cleanPublishableMarkdown(markdown);
  return clean && clean.length <= 20_000 ? clean : null;
}
