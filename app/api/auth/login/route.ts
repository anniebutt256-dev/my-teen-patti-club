import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";

// POST /api/auth/login — username + password sign-in for owner-created
// accounts (no SMS/OTP involved). Sets the same session cookie as OTP login.
export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    const { auth, wallet } = getServices();
    const { user, token } = await auth.loginWithPassword(
      String(username ?? ""),
      String(password ?? ""),
    );
    const balance = await wallet.getBalance(user.id);
    const res = NextResponse.json({
      ok: true,
      balance,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        mobileNumber: user.mobileNumber,
      },
    });
    res.cookies.set("mtpc_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
