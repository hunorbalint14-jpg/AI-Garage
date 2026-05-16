import { cookies } from "next/headers";

const COOKIE = "webauthn_challenge";
const MAX_AGE_SECONDS = 5 * 60;

export async function setChallenge(challenge: string) {
  const store = await cookies();
  store.set(COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getChallenge(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

export async function clearChallenge() {
  const store = await cookies();
  store.delete(COOKIE);
}
