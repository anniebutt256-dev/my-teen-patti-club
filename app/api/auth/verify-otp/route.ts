import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";

export async function POST(req: Request) {
  try {
    const { mobileNumber, code, username, displayName } = await req.json();
    const { auth, wallet } = getServices();
    const { user, token, isNewUser } = await auth.verifyAndLogin(
      String(mobileNumber ?? ""),
      String(code ?? ""),
      { username: username ? String(username) : undefined, displayName },
    );
    const balance = await wallet.getBalance(user.id);
    const res = NextResponse.json({
      ok: true,
      isNewUser,
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
