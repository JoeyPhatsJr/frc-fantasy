/** Spec §4.1: password rules and the error copy the sign-in form shows. */
export const MIN_PASSWORD = 8;

const TAKEN = "There's already an account with that email — sign in instead.";
const SLOW_DOWN = 'Too many tries — wait a minute and try again.';

export function authErrorMessage(err: { code?: string; status?: number } | null | undefined): string {
  switch (err?.code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'user_already_exists':
    case 'email_exists':
      return TAKEN;
    case 'weak_password':
      return `Use at least ${MIN_PASSWORD} characters.`;
    case 'over_request_rate_limit':
      return SLOW_DOWN;
  }
  if (err?.status === 429) return SLOW_DOWN;
  return "Couldn't sign in. Try again.";
}
