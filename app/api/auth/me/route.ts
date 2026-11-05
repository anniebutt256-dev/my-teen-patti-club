import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";
import { sessionUser } from "../../../../src/server/session-user";

function publicUser(u: {
  id: string;
  username: string;
  displayName: string;
  mobileNumber: string;
  avatarUrl: string | null;
  role: string;
  createdAt: number;
}) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    mobileNumber: u.mobileNumber,
    avatarUrl: u.avatarUrl,
    role: u.role,
    createdAt: u.createdAt,
  };
}

// GET /api/auth/me — the logged-in player's profile + balance
export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { wallet } = getServices();
  const balance = await wallet.getBalance(user.id);
  return NextResponse.json({ user: publicUser(user), balance });
}

// PATCH /api/auth/me — update display name. Body: { displayName }
export async function PATCH(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const displayName = String(body.displayName ?? "").trim();
    if (displayName.length < 1 || displayName.length > 40) {
      throw new Error("INVALID_DISPLAY_NAME");
    }
    user.displayName = displayName;
    const { store } = getServices();
    await store.updateUser(user);
    return NextResponse.json({ user: publicUser(user) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
