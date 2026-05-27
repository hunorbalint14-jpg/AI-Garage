import { vi } from "vitest";

// Fluent-builder mock for the Supabase admin client. Returns chain methods
// that all resolve back to the same chain object, so `admin.from("x").select(...).eq(...).maybeSingle()`
// works without per-test setup. Override `canned` to swap the terminal payload.
//
// Usage:
//   const admin = createSupabaseMock({ data: { id: "abc" } });
//   vi.mocked(createAdminClient).mockReturnValue(admin as any);
//
// To assert which tables were queried: `expect(admin.from).toHaveBeenCalledWith("locations")`.
export function createSupabaseMock(canned: { data?: unknown; error?: unknown } = {}) {
  const terminalResult = { data: canned.data ?? null, error: canned.error ?? null };
  const terminal = vi.fn().mockResolvedValue(terminalResult);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "in",
    "or",
    "ilike",
    "lt",
    "gt",
    "gte",
    "lte",
    "is",
    "order",
    "limit",
    "range",
    "match",
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = terminal;
  chain.maybeSingle = terminal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (resolve: any) => Promise.resolve(terminalResult).then(resolve);

  return {
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue(terminalResult),
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        generateLink: vi.fn().mockResolvedValue({ data: { properties: { action_link: "https://link.test" } }, error: null }),
        updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: "u_new" } }, error: null }),
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        mfa: { deleteFactor: vi.fn().mockResolvedValue({ data: {}, error: null }) },
      },
    },
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://upload.test" }, error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://read.test" }, error: null }),
        remove: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }),
    },
    _chain: chain,
    _terminal: terminal,
  };
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;
