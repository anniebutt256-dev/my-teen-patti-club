import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";
import { adminError, adminUser } from "../../../../src/server/admin-http";

export async function GET() {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const { admin } = getServices();
    return NextResponse.json(await admin.overview(actor));
  } catch (e) {
    return adminError(e);
  }
}
