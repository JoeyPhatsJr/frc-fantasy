import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BumperPlate } from '@/components/ui/BumperPlate';
import { Card } from '@/components/ui/Card';
import { DateBlock } from '@/components/DateBlock';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Trophy, ChevronLeft } from '@/components/ui/icons';

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('Button', () => {
  it('is a 44px, pointer, focus-ringed <button> by default', () => {
    const html = render(h(Button, null, 'Save'));
    expect(html).toMatch(/^<button/);
    expect(html).toContain('min-h-11');
    expect(html).toContain('cursor-pointer');
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toContain('Save');
  });

  it('renders an <a> when given href', () => {
    const html = render(h(Button, { href: '/league/abc' }, 'Open'));
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/league/abc"');
    expect(html).toContain('min-h-11');
    expect(html).toContain('cursor-pointer');
  });

  it('uses the smaller height for size sm', () => {
    const html = render(h(Button, { size: 'sm' }, 'Undo'));
    expect(html).toContain('min-h-9');
    expect(html).not.toContain('min-h-11');
  });

  it('size icon is a square 44px button with no padding', () => {
    const html = render(h(Button, { size: 'icon', 'aria-label': 'Move up' }, null));
    expect(html).toContain('size-11');
    expect(html).toContain('p-0');
    expect(html).not.toContain('px-4');
  });

  it('is disabled with a spinner and aria-busy while busy', () => {
    const html = render(h(Button, { busy: true }, 'Saving'));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-spinner');
    expect(html).toContain('Saving');
  });

  it('is rounded-lg, not a pill', () => {
    const html = render(h(Button, null, 'x'));
    expect(html).toContain('rounded-lg');
    expect(html).not.toContain('rounded-pill');
  });

  it('accent is a gold fill with on-accent text, never plain fg (which is light in dark mode)', () => {
    const html = render(h(Button, { variant: 'accent' }, 'Add this round'));
    expect(html).toContain('bg-accent');
    expect(html).toContain('text-on-accent');
    expect(html).not.toContain('text-fg ');
  });

  it('forwards button props and merges className', () => {
    const html = render(h(Button, { type: 'submit', variant: 'danger', className: 'w-full' }, 'Delete'));
    expect(html).toContain('type="submit"');
    expect(html).toContain('w-full');
    expect(html).toContain('text-red-alliance');
  });
});

describe('Badge', () => {
  it('live tone contains the pulsing dot', () => {
    const html = render(h(Badge, { tone: 'live', children: 'Live' }));
    expect(html).toContain('motion-safe:animate-pulse');
    expect(html).toContain('Live');
  });

  it('other tones have no pulsing dot', () => {
    const html = render(h(Badge, { tone: 'final', children: 'Final' }));
    expect(html).not.toContain('animate-pulse');
    expect(html).toContain('rounded-[4px]');
    expect(html).toContain('uppercase');
  });

  it('Badge drafting tone is neutral, not purple', () => {
    const html = render(h(Badge, { tone: 'drafting', children: 'Drafting' }));
    expect(html).not.toContain('bg-secondary');
    expect(html).toContain('bg-surface-2');
  });
});

describe('touch-action', () => {
  it('Button and Input opt into touch-manipulation (no double-tap-zoom delay)', () => {
    expect(render(h(Button, {}, 'Go'))).toContain('touch-manipulation');
    expect(render(h(Input, { label: 'x' }))).toContain('touch-manipulation');
  });
});

describe('Input', () => {
  it('renders a visible label bound to the input', () => {
    const html = render(h(Input, { label: 'League name', id: 'league-name' }));
    expect(html).toContain('<label');
    expect(html).toContain('for="league-name"');
    expect(html).toContain('id="league-name"');
    expect(html).toContain('League name');
    expect(html).toContain('h-11');
  });

  it('generates an id that binds label and input when none is given', () => {
    const html = render(h(Input, { label: 'Name' }));
    const forId = html.match(/for="([^"]+)"/)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toContain(`id="${forId}"`);
  });

  it('shows the error text and marks the input invalid', () => {
    const html = render(h(Input, { label: 'Team', id: 't', error: 'Not in the pool' }));
    expect(html).toContain('Not in the pool');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="t-error"');
  });

  it('shows hint text when there is no error', () => {
    const html = render(h(Input, { label: 'Team', id: 't', hint: 'e.g. 5181' }));
    expect(html).toContain('e.g. 5181');
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="t-hint"');
  });
});

describe('Select', () => {
  it('renders a visible label bound to the select, with options and error', () => {
    const html = render(
      h(Select, { label: 'Player', id: 'p', error: 'Pick one', children: h('option', { value: 'a' }, 'Mom') }),
    );
    expect(html).toContain('for="p"');
    expect(html).toContain('<select');
    expect(html).toContain('id="p"');
    expect(html).toContain('Mom');
    expect(html).toContain('Pick one');
    expect(html).toContain('h-11');
  });
});

describe('Alert', () => {
  it('uses role="alert" for danger', () => {
    expect(render(h(Alert, { tone: 'danger', children: 'Failed' }))).toContain('role="alert"');
  });

  it('uses role="status" for the other tones', () => {
    for (const tone of ['info', 'success', 'warning'] as const) {
      const html = render(h(Alert, { tone, children: 'Note' }));
      expect(html).toContain('role="status"');
      expect(html).not.toContain('role="alert"');
    }
  });
});

describe('Card', () => {
  it('renders title, eyebrow, action and children', () => {
    const html = render(
      h(
        Card,
        { title: 'Standings', eyebrow: 'Season', action: h('a', { href: '/x' }, 'All') },
        h('p', null, 'Body'),
      ),
    );
    expect(html).toContain('Standings');
    expect(html).toContain('Season');
    expect(html).toContain('href="/x"');
    expect(html).toContain('Body');
    expect(html).toContain('rounded-card');
    expect(html).not.toContain('shadow-card');
  });

  it('renders just children when there is no header', () => {
    const html = render(h(Card, null, 'Only body'));
    expect(html).toContain('Only body');
    expect(html).not.toContain('<h2');
  });
});

describe('icons', () => {
  it('are decorative 24x24 stroke SVGs', () => {
    for (const Icon of [Trophy, ChevronLeft]) {
      const html = render(h(Icon, { className: 'size-5' }));
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('fill="none"');
      expect(html).toContain('stroke-width="2"');
      expect(html).toContain('size-5');
    }
  });
});

describe('BumperPlate', () => {
  it('renders the number with an accessible label', () => {
    const html = render(h(BumperPlate, { number: '341' }));
    expect(html).toContain('>341<');
    expect(html).toContain('aria-label="Team 341"');
    expect(html).toContain('role="img"');
  });

  it('is a blue, medium plate by default with white display numerals', () => {
    const html = render(h(BumperPlate, { number: '5181' }));
    expect(html).toContain('bg-primary-fill');
    expect(html).toContain('text-on-primary');
    expect(html).toContain('font-display');
    expect(html).toContain('font-bold');
    expect(html).toContain('rounded-plate');
    expect(html).toContain('tabular-nums');
    expect(html).toContain('h-10');
  });

  it('uses the red-alliance fill for side="red"', () => {
    const html = render(h(BumperPlate, { number: '2607', side: 'red' }));
    expect(html).toContain('bg-red-alliance');
    expect(html).not.toContain('bg-primary-fill');
  });

  it('has 28, 40 and 56 px heights for sm, md and lg', () => {
    expect(render(h(BumperPlate, { number: '1', size: 'sm' }))).toContain('h-7');
    expect(render(h(BumperPlate, { number: '1', size: 'md' }))).toContain('h-10');
    expect(render(h(BumperPlate, { number: '1', size: 'lg' }))).toContain('h-14');
  });

  it('merges className', () => {
    expect(render(h(BumperPlate, { number: '103', className: 'w-full' }))).toContain('w-full');
  });
});

describe('BumperPlate colour', () => {
  it('is blue unless told red', () => {
    expect(render(h(BumperPlate, { number: '5181' }))).toContain('bg-primary-fill');
    expect(render(h(BumperPlate, { number: '5181', side: 'red' }))).toContain('bg-red-alliance');
  });
});

describe('Alert style', () => {
  it('is a left-ruled note with the tone on the border and no fill', () => {
    const html = render(h(Alert, { tone: 'danger', children: 'x' }));
    expect(html).toContain('border-l-4');
    expect(html).toContain('border-red-alliance');
    expect(html).not.toContain('bg-red-alliance/10');
  });
});

describe('DateBlock', () => {
  it('shows the month abbreviation over the day number', () => {
    const html = render(h(DateBlock, { date: '2026-10-24' }));
    expect(html).toContain('>Oct<');
    expect(html).toContain('>24<');
    expect(html.indexOf('Oct')).toBeLessThan(html.indexOf('>24<'));
    expect(html).toContain('dateTime="2026-10-24"');
    expect(html).toContain('font-display');
  });

  it('drops the leading zero and does not shift the day across timezones', () => {
    const html = render(h(DateBlock, { date: '2026-03-01' }));
    expect(html).toContain('>Mar<');
    expect(html).toContain('>1<');
  });
});
