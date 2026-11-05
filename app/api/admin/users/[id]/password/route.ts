import { NextResponse } from "next/server";
import { getServices } from "../../../../../../src/server/services";
import { adminError, adminUser } from "../../../../../../src/server/admin-http";

// POST /api/admin/users/[id]/password — { password, reason }
// Owner sets a new login password for a user (forgot-password help, or
// enabling password login on an OTP-created account).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await adminUser();
  if (actor instanceof NextResponse) return actor;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { admin } = getServices();
    const user = await admin.resetPassword(
      actor,
      id,
      body.password ? String(body.password) : undefined,
      body.reason,
    );
    return NextResponse.json({ user });
  } catch (e) {
    return adminError(e);
  }
}
