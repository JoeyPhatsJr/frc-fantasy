import { describe, expect, it } from 'vitest';
import { authErrorMessage, MIN_PASSWORD } from '@/lib/auth/passwordErrors';

describe('authErrorMessage (spec §4.1 error copy)', () => {
  it('maps Supabase auth error codes to friendly copy', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('Wrong email or password.');
    expect(authErrorMessage({ code: 'user_already_exists' })).toBe(
      "There's already an account with that email — sign in instead.",
    );
    expect(authErrorMessage({ code: 'email_exists' })).toBe(
      "There's already an account with that email — sign in instead.",
    );
    expect(authErrorMessage({ code: 'weak_password' })).toBe('Use at least 8 characters.');
    expect(authErrorMessage({ code: 'over_request_rate_limit' })).toBe(
      'Too many tries — wait a minute and try again.',
    );
    expect(authErrorMessage({ status: 429 })).toBe('Too many tries — wait a minute and try again.');
  });
  it('falls back for anything else', () => {
    expect(authErrorMessage({ code: 'something_new' })).toBe("Couldn't sign in. Try again.");
    expect(authErrorMessage(null)).toBe("Couldn't sign in. Try again.");
  });
  it('minimum password length is 8', () => {
    expect(MIN_PASSWORD).toBe(8);
  });
});
