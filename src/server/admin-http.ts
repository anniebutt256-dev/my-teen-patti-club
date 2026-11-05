// Shared helpers for the /api/admin routes: resolve an ACTIVE admin from
// the session, and map service errors to HTTP statuses consistently.

import { NextResponse } from "next/server";
import { sessionUser } from "./session-user";
import type { UserRecord } from "./store";

export async function adminUser(): Promise<UserRecord | NextResponse> {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return user;
}

export function adminError(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  const status =
    msg === "FORBIDDEN" ? 403 : msg.endsWith("_NOT_FOUND") ? 404 : 400;
  return NextResponse.json({ error: msg }, { status });
}
