// Rooms & lobby service (Phase 3) — public/private rooms, unique room codes,
// password-protected private rooms, 2–6 seats, host ownership, WhatsApp invites.
//
// Room state is ephemeral table state (presence/seating), held in memory here;
// in production this maps to the Room/RoomPlayer tables (schema.prisma) with
// Redis presence. The wallet ledger remains the only record of chip movements.
// A room password is never stored or returned in plaintext: it is hashed with
// scrypt (Node's built-in KDF) + a per-room salt, and never leaves this module.

import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { newId, type Store, type UserRecord } from "./store";

export type RoomType = "PUBLIC" | "PRIVATE";
export type RoomStatus = "WAITING" | "PLAYING" | "CLOSED";

export interface Seat {
  userId: string;
  seatNo: number; // 0-5
  joinedAt: number;
}

export interface RoomRecord {
  id: string;
  code: string;
  name: string;
  type: RoomType;
  passwordHash: string | null; // "salt:hash" scrypt — never exposed publicly
  ownerId: string;
  bootAmount: number;
  status: RoomStatus;
  seats: Seat[]; // only currently seated players
  createdAt: number;
}

/** Public, safe view of a room — no password material, no private game data. */
export interface RoomView {
  id: string;
  code: string;
  name: string;
  type: RoomType;
  bootAmount: number;
  status: RoomStatus;
  ownerId: string;
  playerCount: number;
  maxPlayers: number;
  players: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    seatNo: number;
    isHost: boolean;
  }[];
  inviteUrl: string;
  whatsappUrl: string;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L ambiguity
export const MAX_SEATS = 6;
export const MIN_SEATS_TO_START = 2;
export const DEFAULT_BOOT = 10;
export const MAX_BOOT = 1000;

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function hashRoomPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyRoomPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface CreateRoomOptions {
  name?: string;
  type?: RoomType;
  password?: string;
  bootAmount?: number;
}

export class RoomService {
  private store: Store;
  private rooms = new Map<string, RoomRecord>(); // by room id
  private byCode = new Map<string, string>(); // code -> room id
  private baseUrl: string;

  constructor(store: Store, baseUrl = "") {
    this.store = store;
    this.baseUrl = baseUrl;
  }

  async createRoom(owner: UserRecord, opts: CreateRoomOptions = {}): Promise<RoomRecord> {
    const type: RoomType = opts.type === "PRIVATE" ? "PRIVATE" : "PUBLIC";
    const bootAmount = opts.bootAmount ?? DEFAULT_BOOT;
    if (!Number.isInteger(bootAmount) || bootAmount < 1 || bootAmount > MAX_BOOT) {
      throw new Error("INVALID_BOOT_AMOUNT");
    }
    let passwordHash: string | null = null;
    if (type === "PRIVATE") {
      const pw = opts.password ?? "";
      if (pw.length < 4 || pw.length > 64) throw new Error("ROOM_PASSWORD_REQUIRED");
      passwordHash = hashRoomPassword(pw);
    }
    let code = generateRoomCode();
    while (this.byCode.has(code)) code = generateRoomCode();

    const room: RoomRecord = {
      id: newId("room"),
      code,
      name: (opts.name?.trim() || `${owner.username}'s table`).slice(0, 40),
      type,
      passwordHash,
      ownerId: owner.id,
      bootAmount,
      status: "WAITING",
      seats: [{ userId: owner.id, seatNo: 0, joinedAt: Date.now() }],
      createdAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    this.byCode.set(room.code, room.id);
    return room;
  }

  getByCode(code: string): RoomRecord | null {
    const id = this.byCode.get(normalizeCode(code));
    return id ? (this.rooms.get(id) ?? null) : null;
  }

  getById(id: string): RoomRecord | null {
    return this.rooms.get(id) ?? null;
  }

  isSeated(room: RoomRecord, userId: string): boolean {
    return room.seats.some((s) => s.userId === userId);
  }

  seatOf(room: RoomRecord, userId: string): Seat | null {
    return room.seats.find((s) => s.userId === userId) ?? null;
  }

  /**
   * Join a room. Idempotent for a player who is already seated (reconnect /
   * double-tap returns their existing seat and never double-seats).
   */
  async joinRoom(
    user: UserRecord,
    code: string,
    password?: string,
  ): Promise<{ room: RoomRecord; seat: Seat }> {
    const room = this.getByCode(code);
    if (!room || room.status === "CLOSED") throw new Error("ROOM_NOT_FOUND");

    const existing = this.seatOf(room, user.id);
    if (existing) return { room, seat: existing };

    if (room.type === "PRIVATE") {
      if (!password || !room.passwordHash || !verifyRoomPassword(password, room.passwordHash)) {
        throw new Error("ROOM_PASSWORD_INVALID");
      }
    }
    if (room.status === "PLAYING") throw new Error("ROUND_IN_PROGRESS");
    if (room.seats.length >= MAX_SEATS) throw new Error("ROOM_FULL");

    const used = new Set(room.seats.map((s) => s.seatNo));
    let seatNo = 0;
    while (used.has(seatNo)) seatNo++;
    const seat: Seat = { userId: user.id, seatNo, joinedAt: Date.now() };
    room.seats.push(seat);
    room.seats.sort((a, b) => a.seatNo - b.seatNo);
    return { room, seat };
  }

  /** Remove a player's seat. Host ownership passes to the next seated player;
   *  the room closes when the last player leaves. */
  leaveRoom(userId: string, roomId: string): RoomRecord | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const idx = room.seats.findIndex((s) => s.userId === userId);
    if (idx === -1) return room;
    room.seats.splice(idx, 1);
    if (room.seats.length === 0) {
      room.status = "CLOSED";
      this.byCode.delete(room.code);
      this.rooms.delete(room.id);
      return null;
    }
    if (room.ownerId === userId) {
      room.ownerId = room.seats[0].userId; // lowest remaining seat hosts
    }
    return room;
  }

  /** Force-close a room (admin action): seats are dropped, the code stops
   *  resolving, and the room disappears from every listing. */
  closeRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.status = "CLOSED";
    room.seats = [];
    this.byCode.delete(room.code);
    this.rooms.delete(room.id);
    return true;
  }

  /** Rooms a user is currently seated in (socket reconnect restore). */
  roomsOfUser(userId: string): RoomRecord[] {
    return [...this.rooms.values()].filter((r) => this.isSeated(r, userId));
  }

  listPublicRooms(): RoomRecord[] {
    return [...this.rooms.values()].filter(
      (r) => r.type === "PUBLIC" && r.status !== "CLOSED",
    );
  }

  /** Every tracked live room, public and private (admin dashboard). */
  listAllRooms(): RoomRecord[] {
    return [...this.rooms.values()];
  }

  joinUrl(room: RoomRecord): string {
    return `${this.baseUrl}/lobby?room=${room.code}`;
  }

  /** WhatsApp share link carrying the room code and join link. */
  whatsappUrl(room: RoomRecord): string {
    const text =
      `Join my Teen Patti table "${room.name}" on MY TEEN PATTI CLUB! ` +
      `Room code: ${room.code}. Open: ${this.joinUrl(room)} ` +
      `(Virtual chips only — friendly game, no real money.)`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  async publicView(room: RoomRecord): Promise<RoomView> {
    const players = [];
    for (const seat of [...room.seats].sort((a, b) => a.seatNo - b.seatNo)) {
      const u = await this.store.findUserById(seat.userId);
      players.push({
        userId: seat.userId,
        username: u?.username ?? "player",
        displayName: u?.displayName ?? u?.username ?? "Player",
        avatarUrl: u?.avatarUrl ?? null,
        seatNo: seat.seatNo,
        isHost: seat.userId === room.ownerId,
      });
    }
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      type: room.type,
      bootAmount: room.bootAmount,
      status: room.status,
      ownerId: room.ownerId,
      playerCount: room.seats.length,
      maxPlayers: MAX_SEATS,
      players,
      inviteUrl: this.joinUrl(room),
      whatsappUrl: this.whatsappUrl(room),
    };
  }
}
