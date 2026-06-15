import path from "node:path";
import {
  DEMO_TENANT_SLUG,
  DEMO_PASSWORD,
  DEMO_STAFF,
  DEMO_CUSTOMER,
} from "../../scripts/demo-constants";

// Playwright always runs from the repo root, and (unlike tsx) loads these files
// through its CJS transform — so derive paths from cwd, not import.meta.url
// (which trips an ESM/CJS clash under the Playwright loader on Windows).
const REPO = process.cwd();

export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
export const TENANT_ORIGIN = `http://${DEMO_TENANT_SLUG}.${ROOT_DOMAIN}`;
export const ROOT_ORIGIN = `http://${ROOT_DOMAIN}`;

export const AUTH_DIR = path.join(REPO, "e2e/screenshots/.auth");
export const STAFF_STATE = path.join(AUTH_DIR, "staff.json");
export const CUSTOMER_STATE = path.join(AUTH_DIR, "customer.json");

export const IMAGES_DIR = path.join(REPO, "docs/internal/help-images");

export const CREDS = {
  staffEmail: DEMO_STAFF.email,
  customerEmail: DEMO_CUSTOMER.email,
  password: DEMO_PASSWORD,
};
