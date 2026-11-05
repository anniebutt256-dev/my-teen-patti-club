import { NextResponse } from "next/server";
import { getServices } from "../../../../src/server/services";
import { sessionUser } from "../../../../src/server/session-user";

// GET /api/rooms/[code] — table state for a room.
// Private rooms reveal full state only to seated players; everyone else
// sees a minimal preview (name, type, occupancy) so a password is still
// needed to sit down.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { code } = await params;
  const { rooms, game } = getServices();
  const room = rooms.getByCode(code);
  if (!room || room.status === "CLOSED") {
    return NextResponse.json({ error: "ROOM_NOT_FOUND" }, { status: 404 });
  }
  if (room.type === "PRIVATE" && !rooms.isSeated(room, user.id)) {
    return NextResponse.json({
      room: {
        code: room.code,
        name: room.name,
        type: room.type,
        bootAmount: room.bootAmount,
        status: room.status,
        playerCount: room.seats.length,
        maxPlayers: 6,
        requiresPassword: true,
      },
    });
  }
  const state = await game.publicState(room);
  const hand = game.privateHand(user.id, room.id);
  return NextResponse.json({ ...state, myHand: hand });
}
