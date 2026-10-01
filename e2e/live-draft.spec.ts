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
  const admin = `/api/l/${seed.slug}/admin/rounds/${seed.roundId}`;
  const stateOf = async (req: APIRequestContext) => (await (await req.get(`${base}/draft/state`)).json());

  try {
    const joey = await joeyCtx.newPage();
    const mom = await momCtx.newPage();
    const room = `/l/${seed.slug}/r/${seed.roundId}/draft`;
    await joey.goto(room);
    await mom.goto(room);
    await expect(mom.getByText('Waiting for the commissioner to start the draft').first()).toBeVisible();

    // Start (snake order with roster 3: Joey, Mom, Mom, Joey, Joey, Mom).
    expect((await joeyCtx.request.post(`${admin}/draft/start`)).ok()).toBeTruthy();
    await expect(mom.getByText('On the clock: Joey E2E').first()).toBeVisible({ timeout: 5_000 });

    // 1. Joey picks from the Pool tab; Mom's phone updates within a few seconds.
    await joey.getByRole('button', { name: 'Draft', exact: true }).first().click();
    await joey.getByRole('dialog').getByRole('button', { name: 'Draft', exact: true }).click();
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

    // 3. Pause and resume.
    expect((await joeyCtx.request.post(`${admin}/draft/pause`)).ok()).toBeTruthy();
    await expect(mom.getByText('Paused by commissioner').first()).toBeVisible({ timeout: 5_000 });
    expect((await joeyCtx.request.post(`${admin}/draft/resume`)).ok()).toBeTruthy();
    await expect(mom.getByText('On the clock: Mom E2E').first()).toBeVisible({ timeout: 5_000 });

    // 4. Mom lets the 30 s clock run out: the phones tick and the server auto-picks for her.
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 50_000 }).toBe(3);
    expect((await stateOf(joeyCtx.request)).picks[2]).toMatchObject({ auto: true });

    // 5. Joey turns on auto-draft while on the clock: picks 3 and 4 (both his) happen at once.
    await joey.getByText('Draft options').click();
    await joey.getByLabel('Auto-draft for me').check();
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 10_000 }).toBe(5);

    // 6. Joey (commissioner) undoes his last auto-pick: it stays undone and his auto-draft is off.
    joey.once('dialog', (d) => void d.accept());
    await joey.getByRole('button', { name: 'Undo last pick' }).click();
    await expect.poll(async () => (await stateOf(joeyCtx.request)).pickNumber, { timeout: 10_000 }).toBe(4);
    const after = await stateOf(joeyCtx.request);
    expect(after.me.autodraft).toBe(false);
    expect(after.onClock.name).toBe('Joey E2E');
  } finally {
    await cleanup(seed.leagueId, [joeyId, momId]);
  }
});
