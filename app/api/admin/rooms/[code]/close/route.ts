import { NextResponse } from "next/server";
import { getServices } from "../../../../../../src/server/services";
import { adminError, adminUser } from "../../../../../../src/server/admin-http";

// POST /api/admin/rooms/[code]/close — { reason }
// A live round is aborted first and every bet is refunded via the ledger.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const { code } = await params;
    const body = await req.json().catch(() => ({}));
    const { admin } = getServices();
    return NextResponse.json(await admin.closeRoom(actor, code, body.reason));
  } catch (e) {
    return adminError(e);
  }
}
