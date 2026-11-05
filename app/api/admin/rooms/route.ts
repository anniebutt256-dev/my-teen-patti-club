import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";
import { adminError, adminUser } from "../../../../src/server/admin-http";

// GET /api/admin/rooms — every live room, public and private (admin only)
export async function GET() {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const { admin } = getServices();
    return NextResponse.json({ rooms: await admin.listAllRooms(actor) });
  } catch (e) {
    return adminError(e);
  }
}
