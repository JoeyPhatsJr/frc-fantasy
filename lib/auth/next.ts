// The only place that decides where a sign-in may send someone afterwards (spec §4.1).
const BASE = 'http://same-origin.invalid';
const MAX_LENGTH = 2000;

/** A same-origin relative path, or "/" for anything that could leave the site. */
export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  // Browsers treat a backslash like a slash, and control characters can split headers.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '/';
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
