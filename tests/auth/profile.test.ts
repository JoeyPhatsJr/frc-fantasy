import { describe, expect, it } from 'vitest';
import { avatarFromMetadata, displayNameFromMetadata, ensureProfile } from '@/lib/auth/profile';
import { createMemoryRepo } from '../helpers/memoryRepo';

describe('displayNameFromMetadata (spec §4.2)', () => {
  it('prefers full_name, then name, then user_name', () => {
    expect(displayNameFromMetadata({ full_name: ' Joey Habich ', name: 'x', user_name: 'y' })).toBe('Joey Habich');
    expect(displayNameFromMetadata({ name: 'joey', user_name: 'y' })).toBe('joey');
    expect(displayNameFromMetadata({ user_name: 'joey5181' })).toBe('joey5181');
  });
  it('cuts to 40 characters and falls back to "Player"', () => {
    expect(displayNameFromMetadata({ full_name: 'x'.repeat(60) })).toBe('x'.repeat(40));
    for (const meta of [null, undefined, {}, { full_name: '   ' }, { full_name: 42 }, 'nope']) {
      expect(displayNameFromMetadata(meta), JSON.stringify(meta)).toBe('Player');
    }
  });
  it('strips control characters rather than rejecting the name', () => {
    expect(displayNameFromMetadata({ full_name: 'Jo\u0000ey' })).toBe('Joey');
  });
});

describe('avatarFromMetadata', () => {
  it('takes an https avatar_url or picture, nothing else', () => {
    expect(avatarFromMetadata({ avatar_url: 'https://cdn.discordapp.com/a.png' })).toBe('https://cdn.discordapp.com/a.png');
    expect(avatarFromMetadata({ picture: 'https://lh3.googleusercontent.com/p' })).toBe('https://lh3.googleusercontent.com/p');
    expect(avatarFromMetadata({ avatar_url: 'javascript:alert(1)' })).toBeNull();
    expect(avatarFromMetadata({})).toBeNull();
  });
});

describe('ensureProfile', () => {
  it('creates the profile on first sign-in and leaves it alone afterwards', async () => {
    const repo = createMemoryRepo();
    const first = await ensureProfile(repo, { id: 'u1', user_metadata: { full_name: 'Joey' } });
    expect(first.displayName).toBe('Joey');
    await repo.updateProfile('u1', { displayName: 'Joey H' });
    const second = await ensureProfile(repo, { id: 'u1', user_metadata: { full_name: 'Joey' } });
    expect(second.displayName).toBe('Joey H');
  });
});
