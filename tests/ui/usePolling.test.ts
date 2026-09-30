import { describe, expect, it, vi } from 'vitest';
import { createPoller } from '@/components/admin/usePolling';

/** A fake clock and document: tick() fires the interval, becomeVisible() fires visibilitychange. */
function setup(opts: { reload?: () => Promise<unknown> } = {}) {
  const state = { visible: true, paused: false };
  let intervalFn: (() => void) | null = null;
  let listener: (() => void) | null = null;
  const reload = vi.fn(opts.reload ?? (async () => {}));
  const fakes = {
    setInterval: vi.fn((fn: () => void, _ms: number) => {
      intervalFn = fn;
      return 42;
    }),
    clearInterval: vi.fn((_id: unknown) => {
      intervalFn = null;
    }),
    addListener: vi.fn((fn: () => void) => {
      listener = fn;
    }),
    removeListener: vi.fn((fn: () => void) => {
      if (listener === fn) listener = null;
    }),
  };
  const poller = createPoller({
    reload,
    intervalMs: 30_000,
    isPaused: () => state.paused,
    isVisible: () => state.visible,
    ...fakes,
  });
  return {
    state,
    reload,
    fakes,
    poller,
    tick: () => intervalFn?.(),
    becomeVisible: () => {
      state.visible = true;
      listener?.();
    },
    hide: () => {
      state.visible = false;
      listener?.();
    },
    hasInterval: () => intervalFn !== null,
    hasListener: () => listener !== null,
  };
}

describe('createPoller', () => {
  it('starts one interval at the given period and does not reload immediately', () => {
    const t = setup();
    expect(t.fakes.setInterval).toHaveBeenCalledTimes(1);
    expect(t.fakes.setInterval.mock.calls[0][1]).toBe(30_000);
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('reloads on each tick while visible and not paused', () => {
    const t = setup();
    t.tick();
    t.tick();
    expect(t.reload).toHaveBeenCalledTimes(2);
  });

  it('skips ticks while the tab is hidden', () => {
    const t = setup();
    t.state.visible = false;
    t.tick();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('skips ticks while paused, and resumes when unpaused without a restart', () => {
    const t = setup();
    t.state.paused = true;
    t.tick();
    expect(t.reload).not.toHaveBeenCalled();
    t.state.paused = false;
    t.tick();
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.fakes.setInterval).toHaveBeenCalledTimes(1);
  });

  it('reloads right away when the tab becomes visible, but not when it is hidden', () => {
    const t = setup();
    t.hide();
    expect(t.reload).not.toHaveBeenCalled();
    t.becomeVisible();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on becoming visible while paused', () => {
    const t = setup();
    t.state.paused = true;
    t.becomeVisible();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('stop() clears the interval and removes the listener', () => {
    const t = setup();
    t.poller.stop();
    expect(t.fakes.clearInterval).toHaveBeenCalledWith(42);
    expect(t.fakes.removeListener).toHaveBeenCalledWith(t.fakes.addListener.mock.calls[0][0]);
    expect(t.hasInterval()).toBe(false);
    expect(t.hasListener()).toBe(false);
    t.tick();
    t.becomeVisible();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('swallows a failed reload and keeps polling', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const t = setup({ reload: async () => Promise.reject(new Error('offline')) });
      t.tick();
      t.becomeVisible();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(t.reload).toHaveBeenCalledTimes(2);
      expect(unhandled).not.toHaveBeenCalled();
      t.tick();
      expect(t.reload).toHaveBeenCalledTimes(3);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
