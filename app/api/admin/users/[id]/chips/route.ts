import { NextResponse } from "next/server";
import { getServices } from "../../../../../../src/server/services";
import { adminError, adminUser } from "../../../../../../src/server/admin-http";

// POST /api/admin/users/[id]/chips — { mode: "grant"|"deduct", amount, reason }
// Virtual chips only; every adjustment is a ledger row + an audit entry.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "deduct" ? "deduct" : "grant";
    const { admin, wallet } = getServices();
    const tx = await admin.adjustChips(actor, id, mode, Number(body.amount), body.reason);
    return NextResponse.json({ tx, balance: await wallet.getBalance(id) });
  } catch (e) {
    return adminError(e);
  }
}
