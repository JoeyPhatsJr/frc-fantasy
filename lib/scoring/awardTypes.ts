/** TBA's "Other" award type. The manual Results tab uses it for anything not in the list. */
export const OTHER_AWARD_TYPE = 70;

/**
 * Awards the manual Results tab offers (spec §5.3). Winner (1) and Finalist (2) are left out on
 * purpose: those come from the "Event result" field. Scoring still follows the round's config
 * (byType / excludedTypes / default), exactly as for TBA awards.
 */
export const AWARD_CHOICES: { type: number; name: string }[] = [
  { type: 0, name: 'Impact Award' },
  { type: 9, name: 'Engineering Inspiration Award' },
  { type: 10, name: 'Rookie All Star Award' },
  { type: 15, name: 'Rookie Inspiration Award' },
  { type: 3, name: 'Woodie Flowers Finalist Award' },
  { type: 4, name: "Dean's List Finalist Award" },
  { type: 5, name: 'Volunteer of the Year Award' },
  { type: 11, name: 'Gracious Professionalism Award' },
  { type: 13, name: "Judges' Award" },
  { type: 16, name: 'Industrial Design Award' },
  { type: 17, name: 'Quality Award' },
  { type: 18, name: 'Safety Award' },
  { type: 20, name: 'Creativity Award' },
  { type: 21, name: 'Engineering Excellence Award' },
  { type: 29, name: 'Innovation in Control Award' },
  { type: 71, name: 'Autonomous Award' },
  { type: OTHER_AWARD_TYPE, name: 'Other award' },
];

const NAMES = new Map(AWARD_CHOICES.map((a) => [a.type, a.name]));

export function awardName(type: number): string {
  return NAMES.get(type) ?? `Award (type ${type})`;
}
