import { NextResponse } from "next/server";
import { getServices } from "../../../src/server/services";
import { sessionUser } from "../../../src/server/session-user";

// Wallet reads go through sessionUser, which also refuses SUSPENDED
// accounts — a suspension must bite everywhere, not only at login.
export async function GET() {
  const user = await sessionUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { wallet } = getServices();
  const balance = await wallet.getBalance(user.id);
  const transactions = await wallet.history(user.id, 20);
  return NextResponse.json({ balance, transactions });
}
