/** "2025parr", " 2025PARR ", or a TBA event link → "2025parr". Anything else comes back trimmed and lowercased. */
export function parseEventInput(raw: string): string {
  const s = raw.trim();
  const m = /thebluealliance\.com\/event\/([a-z0-9]+)/i.exec(s);
  return (m ? m[1] : s).toLowerCase();
}
