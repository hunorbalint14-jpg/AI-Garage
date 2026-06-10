import { describe, it, expect } from "vitest";
import {
  renderReminderTemplate,
  isUsableReminderTemplate,
  fallbackReminderEmailTemplate,
  fallbackSmsReminderTemplate,
} from "./reminder-templates";

const VARS = {
  firstName: "Sam",
  vehicle: "2018 Ford Focus",
  registration: "AB18 CDE",
  dueDate: "12 July 2026",
};

describe("renderReminderTemplate", () => {
  it("substitutes every placeholder, including repeats", () => {
    const out = renderReminderTemplate(
      "Hi {{first_name}}, {{registration}} ({{vehicle}}) due {{due_date}}. Bye {{first_name}}.",
      VARS,
    );
    expect(out).toBe("Hi Sam, AB18 CDE (2018 Ford Focus) due 12 July 2026. Bye Sam.");
  });

  it("leaves text without placeholders untouched", () => {
    expect(renderReminderTemplate("no placeholders here", VARS)).toBe("no placeholders here");
  });
});

describe("isUsableReminderTemplate", () => {
  it("accepts a template with all required placeholders", () => {
    expect(
      isUsableReminderTemplate("Hi {{first_name}}, {{registration}} due {{due_date}}."),
    ).toBe(true);
  });

  it.each(["{{first_name}}", "{{registration}}", "{{due_date}}"])(
    "rejects a template missing %s",
    (missing) => {
      const all = "Hi {{first_name}}, {{registration}} due {{due_date}}.";
      expect(isUsableReminderTemplate(all.replace(missing, "X"))).toBe(false);
    },
  );
});

describe("fallback templates", () => {
  it("email fallback renders the established fallback wording", () => {
    const rendered = renderReminderTemplate(fallbackReminderEmailTemplate("mot", "Smith Motors"), VARS);
    expect(rendered).toBe(
      "Hi Sam,\n\nThis is a friendly reminder that your 2018 Ford Focus (AB18 CDE) is due for its MOT on 12 July 2026.\n\nClick the button below to book your appointment with Smith Motors.\n\nThank you for your custom.",
    );
  });

  it("sms fallback renders the established fallback wording", () => {
    const rendered = renderReminderTemplate(fallbackSmsReminderTemplate("service", "Smith Motors"), VARS);
    expect(rendered).toBe(
      "Hi Sam, your AB18 CDE service is due 12 July 2026. Tap the link to book with Smith Motors.",
    );
  });

  it("fallbacks are themselves usable templates", () => {
    expect(isUsableReminderTemplate(fallbackReminderEmailTemplate("mot", "G"))).toBe(true);
    expect(isUsableReminderTemplate(fallbackSmsReminderTemplate("mot", "G"))).toBe(true);
  });
});
