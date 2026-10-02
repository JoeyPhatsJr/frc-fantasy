import { expect, test, type APIRequestContext } from '@playwright/test';
import { cleanup, seedDraft, signIn } from './helpers';

test('two phones run a live draft: pick, race, pause/resume, timeout, auto-draft, undo', async ({ browser }) => {
  const run = Date.now().toString(36);
  const joeyCtx = await browser.newContext();
  const momCtx = await browser.newContext();
  const joeyId = await signIn(joeyCtx, `e2e-joey-${run}@example.com`, 'Joey E2E');
  const momId = await signIn(momCtx, `e2e-mom-${run}@example.com`, 'Mom E2E');
  const seed = await seedDraft(joeyId, momId);
  const base = `/api/l/${seed.slug}/rounds/${seed.roundId}`;
  const stateOf = async (req: APIRequestContext) => (await (await req.get(`${base}/draft/state`)).json());

  try {
    const joey = await joeyCtx.newPage();
    const mom = await momCtx.newPage();
    const room = `/l/${seed.slug}/r/${seed.roundId}/draft`;
    await mom.goto(room);
    await expect(mom.getByText("Draft hasn't started").first()).toBeVisible();
    // Mom's tabs: Pool, My queue, Board (the Board holds every roster; there is no Rosters tab).
    await expect(mom.getByRole('tab', { name: 'Pool' })).toHaveAttribute('aria-selected', 'true');
    await expect(mom.getByRole('tab', { name: 'My queue' })).toBeVisible();
    await expect(mom.getByRole('tab', { name: 'Board' })).toBeVisible();
    await expect(mom.getByRole('tab', { name: 'Rosters' })).toHaveCount(0);
    // Mom is a player: no commissioner controls.
    await expect(mom.getByRole('group', { name: 'Commissioner controls' })).toHaveCount(0);

    // Start from round admin: setup is complete, so step 2 "Run the draft" is open (snake order with
    // roster 3: Joey, Mom, Mom, Joey, Joey, Mom).
    await joey.goto(`/l/${seed.slug}/admin/r/${seed.roundId}`);
    const step2 = joey.getByRole('region', { name: 'Run the draft' });
    await expect(step2).toBeVisible();
    await step2.getByRole('button', { name: 'Start draft' }).click();
    await expect.poll(async () => (await stateOf(joeyCtx.request)).phase, { timeout: 10_000 }).toBe('live');
    await expect(mom.getByText('On the clock: Joey E2E').first()).toBeVisible({ timeout: 5_000 });

    // 1. Joey picks from the Pool tab; the sheet asks "Draft {n} · Projected …?"; Mom's phone updates.
    await joey.goto(room);
    await expect(joey.getByText('Your pick!').first()).toBeVisible();
    await joey.getByRole('button', { name: 'Draft', exact: true }).first().click();
    const sheet = joey.getByRole('dialog');
    await expect(sheet.locator('#confirm-pick-title')).toHaveText(/^Draft \d+ · Projected \d+(\.\d)?\?$/);
    await sheet.getByRole('button', { name: 'Draft', exact: true }).click();
    await expect(mom.getByText('On the clock: Mom E2E').first()).toBeVisible({ timeout: 5_000 });
    await expect(mom.getByText('Your pick!').first()).toBeVisible();

    // 2. A racing double pick from Mom: one 201, one 409.
    const pool = (await (await momCtx.request.get(`${base}/pool`)).json()) as { teamKey: string; available: boolean }[];
    const [t1, t2] = pool.filter((e) => e.available).map((e) => e.teamKey);
    const [r1, r2] = await Promise.all([
      momCtx.request.post(`${base}/draft/pick`, { data: { expectedPickNumber: 1, teamKey: t1 } }),
      momCtx.request.post(`${base}/draft/pick`, { data: { expectedPickNumber: 1, teamKey: t2 } }),
    ]);
    expect([r1.status(), r2.status()].sort()).toEqual([201, 409]);
    expect((await stateOf(joeyCtx.request)).pickNumber).toBe(2);

    // 3. Pause and resume from the commissioner controls in the room.
    const controls = joey.getByRole('group', { name: 'Commissioner controls' });
    await controls.getByRole('button', { name: 'Pause' }).click();
    await expect(mom.getByText('Paused by the commissioner').first()).toBeVisible({ timeout: 5_000 });
    await controls.getByRole('button', { name: 'Resume' }).click();
    await expect(mom.getByText('On the clock: Mom E2E').first()).toBeVisible({ timeout: 5_000 });

    // Mom's Board tab shows the picks so far.
    await mom.getByRole('tab', { name: 'Board' }).click();
    await expect(mom.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    await mom.getByRole('tab', { name: 'Pool' }).click();

    // 4. Mom lets the 30 s clock run out: the phones tick and the server auto-picks for her.
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 50_000 }).toBe(3);
    expect((await stateOf(joeyCtx.request)).picks[2]).toMatchObject({ auto: true });

    // 5. Joey turns on auto-draft while on the clock: picks 3 and 4 (both his) happen at once.
    // .click(), not .check(): the switch follows server state, so poll for the saved result instead.
    const autodraft = joey.getByRole('switch', { name: 'Auto-draft' });
    await expect(autodraft).toHaveAttribute('aria-checked', 'false');
    await autodraft.click();
    await expect.poll(async () => (await stateOf(joeyCtx.request)).me.autodraft, { timeout: 10_000 }).toBe(true);
    await expect(autodraft).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 10_000 }).toBe(5);

    // 6. Joey (commissioner) undoes his last auto-pick: it stays undone and his auto-draft is off.
    // Wait for his phone to show pick 5 first: Undo names the last pick it knows of, and the server refuses
    // (409) an undo of a pick that is no longer the last — which is what a stale screen would send.
    await expect(joey.getByText('On the clock: Mom E2E').first()).toBeVisible({ timeout: 10_000 });
    joey.once('dialog', (d) => void d.accept());
    await controls.getByRole('button', { name: 'Undo last pick' }).click();
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 10_000 }).toBe(4);
    const after = await stateOf(joeyCtx.request);
    expect(after.me.autodraft).toBe(false);
    expect(after.onClock.name).toBe('Joey E2E');
    await expect(autodraft).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });
  } finally {
    await cleanup(seed.leagueId, [joeyId, momId]);
  }
});
