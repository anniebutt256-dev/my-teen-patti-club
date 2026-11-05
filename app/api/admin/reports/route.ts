import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";
import { adminError, adminUser } from "../../../../src/server/admin-http";

// GET /api/admin/reports?status=OPEN|REVIEWED|DISMISSED (admin only)
export async function GET(req: Request) {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    const { admin } = getServices();
    return NextResponse.json({ reports: await admin.listReports(actor, status) });
  } catch (e) {
    return adminError(e);
  }
}
