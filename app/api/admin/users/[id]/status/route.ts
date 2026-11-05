import { NextResponse } from "next/server";
import { getServices } from "../../../../../../src/server/services";
import { adminError, adminUser } from "../../../../../../src/server/admin-http";

// POST /api/admin/users/[id]/status — { status: "ACTIVE"|"SUSPENDED", reason }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const status = body.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    const { admin } = getServices();
    const user = await admin.setUserStatus(actor, id, status, body.reason);
    return NextResponse.json({ user: { id: user.id, status: user.status } });
  } catch (e) {
    return adminError(e);
  }
}
