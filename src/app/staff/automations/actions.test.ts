import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/cron/schedule", () => ({ computeNextRunAt: vi.fn(() => new Date()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { updateSchedule, toggleTask, updateTaskSettings, runTaskNow } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["updateSchedule", () => updateSchedule("t_1", "daily", 9, null)],
  ["toggleTask", () => toggleTask("t_1", true)],
  ["updateTaskSettings", () => updateTaskSettings("t_1", { window_days: 30 })],
  ["runTaskNow", () => runTaskNow("mot_reminders")],
])("%s denies without automations perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ automations: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
