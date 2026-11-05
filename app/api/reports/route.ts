import { NextResponse } from "next/server";
import { getServices } from "../../../src/server/services";
import { sessionUser } from "../../../src/server/session-user";

// POST /api/reports — a player files a report.
// Body: { targetId?, targetUsername?, roomCode?, reason }
export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const { admin } = getServices();
    const report = await admin.createReport(user, {
      targetId: body.targetId ? String(body.targetId) : undefined,
      targetUsername: body.targetUsername ? String(body.targetUsername) : undefined,
      roomCode: body.roomCode ? String(body.roomCode) : undefined,
      reason: body.reason ? String(body.reason) : undefined,
    });
    return NextResponse.json({ report }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    const status = msg.endsWith("_NOT_FOUND") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

// GET /api/reports — the player's own filed reports
export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { store } = getServices();
  const mine = (await store.listReports()).filter((r) => r.reporterId === user.id);
  return NextResponse.json({ reports: mine });
}
