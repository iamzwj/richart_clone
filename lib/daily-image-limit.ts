import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DAILY_IMAGE_LIMIT = 100;

type Reservation = { count: number; expiresAt: number };
type DayUsage = { generated: number; reservations: Record<string, Reservation> };
type UsageStore = { days: Record<string, DayUsage> };
export type DailyImageReservation = { id: string; day: string; count: number };

const storePath = () => process.env.DAILY_IMAGE_LIMIT_STORE_PATH || join(process.cwd(), "data", "daily-image-limit.json");
const RESERVATION_TTL_MS = 20 * 60 * 1_000;
let writeQueue: Promise<void> = Promise.resolve();

function shanghaiDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function cleanDay(value: unknown, now: number): DayUsage {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const generated = typeof source.generated === "number" && Number.isFinite(source.generated)
    ? Math.max(0, Math.floor(source.generated))
    : 0;
  const rawReservations = source.reservations && typeof source.reservations === "object"
    ? source.reservations as Record<string, unknown>
    : {};
  const reservations = Object.fromEntries(Object.entries(rawReservations).flatMap(([id, value]) => {
    if (!value || typeof value !== "object") return [];
    const reservation = value as Record<string, unknown>;
    const count = typeof reservation.count === "number" ? Math.floor(reservation.count) : 0;
    const expiresAt = typeof reservation.expiresAt === "number" ? reservation.expiresAt : 0;
    return count > 0 && expiresAt > now ? [[id, { count, expiresAt }]] : [];
  }));
  return { generated, reservations };
}

async function readStore(): Promise<UsageStore> {
  try {
    const value = JSON.parse(await readFile(storePath(), "utf8")) as unknown;
    return value && typeof value === "object" && "days" in value && (value as { days?: unknown }).days && typeof (value as { days?: unknown }).days === "object"
      ? value as UsageStore
      : { days: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return { days: {} };
    throw error;
  }
}

async function writeStore(store: UsageStore) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function mutate<T>(operation: (store: UsageStore, now: number) => T): Promise<T> {
  let result!: T;
  const job = writeQueue.then(async () => {
    const now = Date.now();
    const store = await readStore();
    const day = shanghaiDay(new Date(now));
    store.days = { [day]: cleanDay(store.days?.[day], now) };
    result = operation(store, now);
    await writeStore(store);
  });
  writeQueue = job.catch(() => undefined);
  await job;
  return result;
}

function reservedImages(day: DayUsage): number {
  return Object.values(day.reservations).reduce((total, reservation) => total + reservation.count, 0);
}

export async function reserveDailyImages(count: number): Promise<DailyImageReservation | null> {
  const requested = Math.max(1, Math.floor(count));
  if (requested > DAILY_IMAGE_LIMIT) return null;

  return mutate((store, now) => {
    const dayKey = shanghaiDay(new Date(now));
    const day = store.days[dayKey];
    if (day.generated + reservedImages(day) + requested > DAILY_IMAGE_LIMIT) return null;
    const id = randomUUID();
    day.reservations[id] = { count: requested, expiresAt: now + RESERVATION_TTL_MS };
    return { id, day: dayKey, count: requested };
  });
}

export async function completeDailyImageReservation(reservation: DailyImageReservation, generated: number): Promise<void> {
  const completed = Math.max(0, Math.min(reservation.count, Math.floor(generated)));
  await mutate((store) => {
    const day = store.days[reservation.day];
    if (!day) return;
    delete day.reservations[reservation.id];
    day.generated += completed;
  });
}

export async function releaseDailyImageReservation(reservation: DailyImageReservation): Promise<void> {
  await mutate((store) => {
    const day = store.days[reservation.day];
    if (day) delete day.reservations[reservation.id];
  });
}
