import { NextResponse } from "next/server";
import { getServices } from "../../../../../src/server/services";
import { sessionUser } from "../../../../../src/server/session-user";

// POST /api/rooms/[code]/leave — give up the seat. Leaving mid-round packs
// the player's hand (their bets stay in the pot), handled by the game service.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { code } = await params;
  const { rooms, game } = getServices();
  const room = rooms.getByCode(code);
  if (!room) return NextResponse.json({ error: "ROOM_NOT_FOUND" }, { status: 404 });
  await game.handlePlayerLeft(user.id, room);
  const after = rooms.leaveRoom(user.id, room.id);
  return NextResponse.json({ ok: true, roomClosed: after === null });
}
