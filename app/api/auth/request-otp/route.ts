import { NextResponse } from "next/server";
import { devPeekOtp, getServices } from "../../../../src/server/services";

export async function POST(req: Request) {
  try {
    const { mobileNumber } = await req.json();
    const { auth } = getServices();
    const { expiresAt } = await auth.requestOtp(String(mobileNumber ?? ""));
    const body: Record<string, unknown> = { ok: true, expiresAt };
    // Dev only: without an SMS provider there is no other delivery channel.
    if (process.env.NODE_ENV !== "production") {
      body.devCode = devPeekOtp(String(mobileNumber));
    }
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    const status = msg === "OTP_RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
