import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseAuthEnv } from '@/lib/supabase/server';

afterEach(() => vi.unstubAllEnvs());

describe('supabaseAuthEnv', () => {
  it('reads the public URL and anon key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    expect(supabaseAuthEnv()).toEqual({ url: 'https://abc.supabase.co', anonKey: 'anon-key' });
  });

  it('names the missing variable', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    expect(() => supabaseAuthEnv()).toThrow('NEXT_PUBLIC_SUPABASE_URL is not set');
  });
});
