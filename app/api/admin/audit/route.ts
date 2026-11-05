import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";
import { adminError, adminUser } from "../../../../src/server/admin-http";

// GET /api/admin/audit — recent admin audit log (admin only)
export async function GET() {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const { admin } = getServices();
    return NextResponse.json({ audit: await admin.listAudit(actor, 50) });
  } catch (e) {
    return adminError(e);
  }
}
