// Spec §4.4: 6 characters, no 0/O/1/I/L, stored uppercase, matched case-insensitively.
// No node:* imports: the invite-code box on the landing page imports normalizeInviteCode in the browser.
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** Web Crypto works in Node 20+ and browsers. The modulo bias over 2^32 is negligible for 31 symbols. */
function secureIndex(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

export function generateInviteCode(randomIndex: (n: number) => number = secureIndex): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[randomIndex(INVITE_ALPHABET.length)];
  return code;
}

/** "abc234 " → "ABC234"; anything that can't be a code → null (callers answer a uniform 404). */
export function normalizeInviteCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return INVITE_CODE_RE.test(code) ? code : null;
}
