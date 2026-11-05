import { NextResponse } from "next/server";
import { getServices } from "../../../src/server/services";
import { sessionUser } from "../../../src/server/session-user";

// GET /api/rooms — public lobby listing (login required)
export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { rooms } = getServices();
  const views = [];
  for (const room of rooms.listPublicRooms()) {
    views.push(await rooms.publicView(room));
  }
  return NextResponse.json({ rooms: views });
}

// POST /api/rooms — create a room; the creator takes seat 0 and hosts.
// Body: { name?, type?: "PUBLIC"|"PRIVATE", password?, bootAmount? }
export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const { rooms } = getServices();
    const room = await rooms.createRoom(user, {
      name: body.name ? String(body.name) : undefined,
      type: body.type === "PRIVATE" ? "PRIVATE" : "PUBLIC",
      password: body.password ? String(body.password) : undefined,
      bootAmount:
        body.bootAmount !== undefined ? Number(body.bootAmount) : undefined,
    });
    const view = await rooms.publicView(room);
    return NextResponse.json({ room: view }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
