// WebAuthn relying party configuration.
// RP ID must be a registrable domain that covers all subdomains where passkeys
// should work. With wildcard tenant subdomains (*.ai-garage.co.uk) we use the
// apex domain so a passkey registered on tenantA.ai-garage.co.uk is usable on
// tenantB.ai-garage.co.uk.

export function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID
    ?? process.env.ROOT_DOMAIN
    ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN
    ?? "localhost";
}

export function getRpName(): string {
  return process.env.WEBAUTHN_RP_NAME ?? "AI Garage";
}

// Allowed origins for verification. We accept the apex + any subdomain over
// HTTPS, plus localhost for dev.
export function getExpectedOrigins(): string[] {
  const rpId = getRpId();
  const origins: string[] = [];
  if (rpId === "localhost") {
    origins.push("http://localhost:3000", "http://localhost:3001");
  } else {
    origins.push(`https://${rpId}`);
    // Subdomains — match anything *.rpId
    // SimpleWebAuthn supports a regex/function; we pass an explicit list,
    // so the caller should pass the actual origin. The library checks against
    // this list. To allow all subdomains we accept a function.
  }
  return origins;
}

// Used by the verify functions — accept the origin from the request as long
// as it matches the RP ID. Returning true delegates origin matching to the
// caller's check using the rpId, which SimpleWebAuthn validates separately.
export function isOriginAllowed(origin: string): boolean {
  const rpId = getRpId();
  if (rpId === "localhost") {
    return origin === "http://localhost:3000" || origin === "http://localhost:3001";
  }
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (
      url.hostname === rpId || url.hostname.endsWith(`.${rpId}`)
    );
  } catch {
    return false;
  }
}
