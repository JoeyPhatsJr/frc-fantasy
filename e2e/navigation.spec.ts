import { expect, test, type Page } from '@playwright/test';
import { cleanup, seedDraft, signIn } from './helpers';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('bottom bar and league tabs get a member everywhere; the live-draft pill leads to the room', async ({ browser }) => {
  const run = Date.now().toString(36);
  const joeyCtx = await browser.newContext();
  const momCtx = await browser.newContext();
  const joeyId = await signIn(joeyCtx, `e2e-nav-joey-${run}@example.com`, 'Joey E2E');
  const momId = await signIn(momCtx, `e2e-nav-mom-${run}@example.com`, 'Mom E2E');
  const leagueName = `E2E Nav ${run}`;
  const seed = await seedDraft(joeyId, momId, leagueName);
  const league = `/l/${seed.slug}`;
  const event = `${league}/r/${seed.roundId}`;
  const room = `${event}/draft`;

  const appBar = (p: Page) => p.locator('nav[aria-label="App"]');
  const leagueTabs = (p: Page) => p.locator('nav[aria-label="League"]');

  try {
    const joey = await joeyCtx.newPage();

    // Home: the bottom bar and "Your leagues".
    await joey.goto('/');
    await expect(appBar(joey)).toBeVisible();
    await expect(appBar(joey).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    const yourLeagues = joey.locator('section').filter({ has: joey.getByRole('heading', { name: 'Your leagues' }) });
    await expect(yourLeagues).toBeVisible();

    // The league row opens Standings.
    await yourLeagues.getByRole('link', { name: new RegExp(escape(leagueName)) }).click();
    await expect(joey).toHaveURL(new RegExp(`${escape(league)}$`));
    await expect(leagueTabs(joey)).toBeVisible();
    await expect(leagueTabs(joey).getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page');
    await expect(appBar(joey)).toBeVisible();
    await expect(appBar(joey).getByRole('link', { name: 'Leagues' })).toHaveAttribute('aria-current', 'page');

    // Event tab: the round page with its status strip.
    await leagueTabs(joey).getByRole('link', { name: 'Event' }).click();
    await expect(joey).toHaveURL(new RegExp(`${escape(event)}$`));
    await expect(leagueTabs(joey).getByRole('link', { name: 'Event' })).toHaveAttribute('aria-current', 'page');
    await expect(joey.getByRole('region', { name: 'Status' })).toBeVisible();
    await expect(appBar(joey)).toBeVisible();

    // Draft tab: the round's draft room.
    await leagueTabs(joey).getByRole('link', { name: 'Draft' }).click();
    await expect(joey).toHaveURL(/\/draft$/);
    await expect(leagueTabs(joey).getByRole('link', { name: 'Draft' })).toHaveAttribute('aria-current', 'page');
    await expect(joey.getByText("Draft hasn't started").first()).toBeVisible();
    await expect(appBar(joey)).toBeVisible();

    // Admin tab (commissioner only), then back to Standings.
    await leagueTabs(joey).getByRole('link', { name: 'Admin' }).click();
    await expect(joey).toHaveURL(new RegExp(`${escape(league)}/admin$`));
    await expect(appBar(joey)).toBeVisible();
    await leagueTabs(joey).getByRole('link', { name: 'Standings' }).click();
    await expect(joey).toHaveURL(new RegExp(`${escape(league)}$`));
    await expect(appBar(joey)).toBeVisible();

    // The bottom bar: Leagues, You, Home.
    await appBar(joey).getByRole('link', { name: 'Leagues' }).click();
    await expect(joey).toHaveURL(/\/leagues$/);
    await expect(appBar(joey)).toBeVisible();
    await appBar(joey).getByRole('link', { name: 'You' }).click();
    await expect(joey).toHaveURL(/\/you$/);
    await expect(appBar(joey).getByRole('link', { name: 'You' })).toHaveAttribute('aria-current', 'page');
    await appBar(joey).getByRole('link', { name: 'Home' }).click();
    await expect(joey).toHaveURL(/localhost:3100\/$/);
    await expect(appBar(joey)).toBeVisible();

    // Once the draft is live, members get the gold pill on every page but the room and Home. Joey is first on the clock.
    const started = await joeyCtx.request.post(`/api/l/${seed.slug}/admin/rounds/${seed.roundId}/draft/start`);
    expect(started.ok()).toBeTruthy();

    // Mom isn't on the clock: "Draft is live — {league} · Join". (Not on Home: its Up next card shows the draft.)
    const mom = await momCtx.newPage();
    await mom.goto('/leagues');
    const momPill = mom.getByRole('link', { name: new RegExp(`^Draft is live — ${escape(leagueName)}`) });
    await expect(momPill).toBeVisible();
    await expect(momPill).toHaveAttribute('href', room);

    // Home leads with the draft in its Up next card, so the pill steps aside there.
    await joey.goto('/');
    await expect(joey.getByRole('link', { name: 'Open draft room' })).toBeVisible();
    await expect(joey.getByRole('link', { name: new RegExp(`^Your pick! — ${escape(leagueName)}`) })).toHaveCount(0);

    // Joey is: "Your pick! — {league}". The pill takes him to the room, where it steps aside.
    await joey.goto('/leagues');
    const joeyPill = joey.getByRole('link', { name: new RegExp(`^Your pick! — ${escape(leagueName)}`) });
    await expect(joeyPill).toBeVisible();
    await joeyPill.click();
    await expect(joey).toHaveURL(new RegExp(`${escape(room)}$`));
    await expect(joey.getByText('On the clock: Joey E2E').first()).toBeVisible();
    await expect(joey.getByRole('link', { name: new RegExp(`^Your pick! — ${escape(leagueName)}`) })).toHaveCount(0);
    await expect(appBar(joey)).toBeVisible();
  } finally {
    await cleanup(seed.leagueId, [joeyId, momId]);
  }
});
