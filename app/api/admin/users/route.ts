import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";
import { adminError, adminUser } from "../../../../src/server/admin-http";

// GET /api/admin/users?q=search — user list with balances (admin only)
export async function GET(req: Request) {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const { admin } = getServices();
    return NextResponse.json({ users: await admin.listUsers(actor, q) });
  } catch (e) {
    return adminError(e);
  }
}

// POST /api/admin/users — owner creates an account for a friend
// { username, password, displayName? } → friend signs in with username+password.
export async function POST(req: Request) {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const body = await req.json().catch(() => ({}));
    const { admin } = getServices();
    const user = await admin.createAccount(actor, {
      username: body.username ? String(body.username) : undefined,
      password: body.password ? String(body.password) : undefined,
      displayName: body.displayName ? String(body.displayName) : undefined,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    return adminError(e);
  }
}
