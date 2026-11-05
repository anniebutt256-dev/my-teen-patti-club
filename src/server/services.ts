// Service wiring (singleton). Uses the Prisma store when DATABASE_URL is set
// (production), otherwise an in-memory store for local development so the app
// runs without a database. Dev SMS sender is used until a real SMS provider
// is connected — in production build the sender MUST be a provider client.

import { InMemoryStore, type Store } from "./store";
import { DevSmsSender, OtpService, type SmsSender } from "./otp";
import { WalletService } from "./wallet";
import { AuthService } from "./auth";
import { RoomService } from "./rooms";
import { GameService } from "./game";
import { AdminService } from "./admin";

interface Services {
  store: Store;
  sms: SmsSender;
  otp: OtpService;
  wallet: WalletService;
  auth: AuthService;
  rooms: RoomService;
  game: GameService;
  admin: AdminService;
}

const g = globalThis as unknown as { __mtpc?: Services };

export function getServices(): Services {
  if (g.__mtpc) return g.__mtpc;

  let store: Store;
  if (process.env.DATABASE_URL) {
    // Lazy require so local dev/tests never load the Prisma client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaStore } = require("./prisma-store");
    store = new PrismaStore();
  } else {
    store = new InMemoryStore();
  }

  const sms: SmsSender = new DevSmsSender();
  const otp = new OtpService(store, sms);
  const wallet = new WalletService(store);
  const auth = new AuthService(store, otp, wallet);
  const rooms = new RoomService(store, process.env.PUBLIC_BASE_URL ?? "");
  const game = new GameService(wallet, rooms, store);
  const admin = new AdminService(store, wallet, rooms, game);

  g.__mtpc = { store, sms, otp, wallet, auth, rooms, game, admin };
  return g.__mtpc;
}

/** Dev helper: latest dev-mode OTP for a number (never in production wiring).
 *  Duck-typed on purpose: the custom server and the Next bundle load separate
 *  module copies, so `instanceof DevSmsSender` can fail across that boundary
 *  even though both share the same services singleton. */
export function devPeekOtp(mobileNumber: string): string | null {
  const s = getServices();
  const lastCode = (s.sms as Partial<DevSmsSender>).lastCode;
  if (lastCode instanceof Map) return lastCode.get(mobileNumber) ?? null;
  return null;
}
