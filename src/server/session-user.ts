// Shared helper for API routes: resolve the logged-in user from the
// httpOnly session cookie. Returns the full user record or null.

import { cookies } from "next/headers";
import { verifySession } from "./session";
import { getServices } from "./services";
import type { UserRecord } from "./store";

export async function sessionUser(): Promise<UserRecord | null> {
  const jar = await cookies();
  const token = jar.get("mtpc_session")?.value;
  const userId = token ? verifySession(token) : null;
  if (!userId) return null;
  const { store } = getServices();
  const user = await store.findUserById(userId);
  if (!user || user.status === "SUSPENDED") return null;
  return user;
}
