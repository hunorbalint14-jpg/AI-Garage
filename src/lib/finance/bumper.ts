import crypto from "node:crypto";

// Bumper Payment Solutions v2 — PayByLink. We raise an application
// server-side, get a hosted redirect_url, and send the customer there;
// card/credit data never touches us. Signing algorithm verified against
// Bumper's published example: HMAC-SHA256 over the upper-cased,
// alphabetically sorted params with a trailing '&', booleans serialized
// Python-style.

export type BumperConfig = {
  apiKey: string;
  secret: string;
  demoMode: boolean;
};

function baseUrl(config: BumperConfig): string {
  return config.demoMode ? "https://api.demo.bumper.co" : "https://api.bumper.co";
}

// Params that are sent but never signed, per Bumper's spec.
const SIGNATURE_EXCLUDE = new Set([
  "api_key",
  "signature",
  "product_description",
  "preferred_product_type",
  "additional_data",
]);

function serialize(value: unknown): string {
  // Bumper signs booleans Python-style: true → "True", false → "False".
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

/** HMAC-SHA256 signature for the POST /v2/apply/ body. Exported for tests. */
export function signApply(body: Record<string, unknown>, secret: string): string {
  const base = Object.entries(body)
    .filter(([k, v]) => !SIGNATURE_EXCLUDE.has(k) && v !== undefined && v !== null)
    .map(([k, v]) => [k.toUpperCase(), serialize(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}&`) // trailing & on every pair, including the last
    .join("");
  return crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");
}

/** Signature for GET /v2/status/ — token only. */
export function signStatus(token: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`TOKEN=${token}&`, "utf8").digest("hex");
}

/** Verify the signature Bumper appends to success_url/failure_url. */
export function verifyRedirect(
  q: { success: string; token: string; signature: string },
  secret: string,
): boolean {
  // Only success + token are signed, sorted alphabetically (SUCCESS < TOKEN).
  // The success value is signed exactly as it arrives in the query string.
  const base = `SUCCESS=${q.success}&TOKEN=${q.token}&`;
  const expected = crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(q.signature ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type BumperProductLine = { item: string; quantity: string; price: string };

export type BumperApplyInput = {
  productType: "paylater" | "paynow";
  /** "300.00" — two decimal places. */
  amount: string;
  orderReference: string;
  invoiceNumber?: string;
  vehicleReg?: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    mobile: string;
    /** Bumper requires at least one of flat/building name/building number. */
    flatNumber?: string;
    buildingName?: string;
    buildingNumber?: string;
    street?: string;
    town: string;
    county?: string;
    postcode: string;
  };
  lines: BumperProductLine[];
  successUrl: string;
  failureUrl: string;
};

export type BumperApplyResult = { token: string; redirect_url: string };

export async function bumperApply(
  input: BumperApplyInput,
  config: BumperConfig,
): Promise<BumperApplyResult> {
  const body: Record<string, unknown> = {
    api_key: config.apiKey,
    preferred_product_type: input.productType,
    amount: input.amount,
    currency: "GBP",
    order_reference: input.orderReference,
    invoice_number: input.invoiceNumber,
    vehicle_reg: input.vehicleReg,
    first_name: input.customer.firstName,
    last_name: input.customer.lastName,
    email: input.customer.email,
    mobile: input.customer.mobile,
    flat_number: input.customer.flatNumber,
    building_name: input.customer.buildingName,
    building_number: input.customer.buildingNumber,
    street: input.customer.street,
    town: input.customer.town,
    county: input.customer.county,
    country: "UK",
    postcode: input.customer.postcode,
    product_description: input.lines,
    success_url: input.successUrl,
    failure_url: input.failureUrl,
    send_sms: false,
    send_email: false,
  };

  // The signed body must equal the sent body exactly — drop undefined first.
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  body.signature = signApply(body, config.secret);

  const res = await fetch(`${baseUrl(config)}/v2/apply/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    success: boolean;
    message?: string;
    data?: BumperApplyResult;
  };
  if (!res.ok || !json.success || !json.data) {
    throw new Error(`Bumper apply failed: ${json.message ?? res.status}`);
  }
  return json.data;
}

export type BumperStatusValue =
  | "pending"
  | "inprogress"
  | "completed"
  | "failed"
  | "cancelled"
  | "error";

export type BumperStatusResult = {
  token: string;
  status: BumperStatusValue;
  amount?: string;
  invoicenumber?: string;
  initial_payment_type?: string;
  payment_type?: string;
};

export async function bumperStatus(
  token: string,
  config: BumperConfig,
): Promise<BumperStatusResult> {
  const url = new URL(`${baseUrl(config)}/v2/status/`);
  url.searchParams.set("api_key", config.apiKey);
  url.searchParams.set("token", token);
  url.searchParams.set("signature", signStatus(token, config.secret));

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const json = (await res.json()) as {
    success: boolean;
    message?: string;
    data?: BumperStatusResult;
  };
  if (!json.success || !json.data) {
    throw new Error(`Bumper status failed: ${json.message ?? res.status}`);
  }
  return json.data;
}
