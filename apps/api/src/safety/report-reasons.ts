// The typed reason taxonomy for reports (BLUEPRINT §08: "typed reason
// taxonomy, not free text alone"). A closed list so reports can be counted,
// routed and prioritised later; anything that doesn't fit is OTHER, with the
// details field for the rest. The web client keeps its own copy of the labels
// (apps/web/src/lib/api.ts) — keep the two in step.
export const REPORT_REASONS = [
  'HARASSMENT',
  'SAFETY_CONCERN',
  'FAKE_PROFILE',
  'INAPPROPRIATE_CONTENT',
  'SPAM',
  'NO_SHOW',
  'OTHER',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
