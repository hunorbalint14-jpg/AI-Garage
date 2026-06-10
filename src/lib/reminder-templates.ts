// Reusable reminder message templates. The cron route drafts ONE template per
// (location, reminder type, channel kind) per run and substitutes per-customer
// values locally — instead of one Claude call per customer, which dominated
// the route's runtime and AI spend.
//
// Kept free of SDK imports so it stays unit-testable without an Anthropic key.

export type ReminderTemplateVars = {
  firstName: string;
  vehicle: string;
  registration: string;
  dueDate: string;
};

// A usable template must contain at least these — a draft that dropped one
// would send the same text to every customer with details missing.
export const REQUIRED_PLACEHOLDERS = ["{{first_name}}", "{{registration}}", "{{due_date}}"] as const;

export function isUsableReminderTemplate(template: string): boolean {
  return REQUIRED_PLACEHOLDERS.every((p) => template.includes(p));
}

export function renderReminderTemplate(template: string, vars: ReminderTemplateVars): string {
  return template
    .replaceAll("{{first_name}}", vars.firstName)
    .replaceAll("{{vehicle}}", vars.vehicle)
    .replaceAll("{{registration}}", vars.registration)
    .replaceAll("{{due_date}}", vars.dueDate);
}

// Static fallbacks when the AI draft fails or omits a required placeholder.
// Wording matches the per-customer fallbackReminderMessage /
// fallbackSmsReminderMessage in ai-messages.ts.

export function fallbackReminderEmailTemplate(
  reminderType: "mot" | "service",
  garageName: string,
): string {
  const label = reminderType === "mot" ? "MOT" : "service";
  return `Hi {{first_name}},\n\nThis is a friendly reminder that your {{vehicle}} ({{registration}}) is due for its ${label} on {{due_date}}.\n\nClick the button below to book your appointment with ${garageName}.\n\nThank you for your custom.`;
}

export function fallbackSmsReminderTemplate(
  reminderType: "mot" | "service",
  garageName: string,
): string {
  const label = reminderType === "mot" ? "MOT" : "service";
  return `Hi {{first_name}}, your {{registration}} ${label} is due {{due_date}}. Tap the link to book with ${garageName}.`;
}
