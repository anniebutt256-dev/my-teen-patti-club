import { NextResponse } from "next/server";
import { getServices } from "../../../../../../src/server/services";
import { adminError, adminUser } from "../../../../../../src/server/admin-http";

// POST /api/admin/reports/[id]/review — { status: "REVIEWED"|"DISMISSED", reason? }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const status = body.status === "DISMISSED" ? "DISMISSED" : "REVIEWED";
    const { admin } = getServices();
    const report = await admin.reviewReport(actor, id, status, body.reason);
    return NextResponse.json({ report });
  } catch (e) {
    return adminError(e);
  }
}
