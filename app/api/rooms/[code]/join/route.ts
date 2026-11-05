import { NextResponse } from "next/server";
import { getServices } from "../../../../../src/server/services";
import { sessionUser } from "../../../../../src/server/session-user";

// POST /api/rooms/[code]/join — take a seat. Body: { password? } for private rooms.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { code } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const { rooms, game } = getServices();
    const { room, seat } = await rooms.joinRoom(
      user,
      code,
      body.password ? String(body.password) : undefined,
    );
    const state = await game.publicState(room);
    return NextResponse.json({ seat: seat.seatNo, ...state });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    const status = msg === "ROOM_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
