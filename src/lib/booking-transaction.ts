import type { Prisma, PrismaClient } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { recordBookingTiming, timeBooking } from './booking-telemetry';

// Only model/method names become dimensions; arguments and raw SQL never do.
export function timedDatabase<T extends object>(database: T): T {
  const models = new Map<PropertyKey, object>();
  const phase = (value: string) => value.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  return new Proxy(database, { get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    if (typeof key !== 'string') return value;
    if (typeof value === 'function') {
      if (['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].includes(key))
        return (...args: unknown[]) => timeBooking('db.raw', () => Reflect.apply(value, target, args));
      return value.bind(target);
    }
    if (!value || typeof value !== 'object' || !/^[a-z][a-zA-Z0-9]*$/.test(key)) return value;
    if (!models.has(key)) models.set(key, new Proxy(value, { get(model, method) {
      const operation = Reflect.get(model, method);
      return typeof operation === 'function' && typeof method === 'string'
        ? (...args: unknown[]) => timeBooking(`db.${phase(key)}.${phase(method)}`, () => Reflect.apply(operation, model, args)) : operation;
    } }));
    return models.get(key);
  } });
}

export async function bookingTransaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>, options = { maxWait: 10000, timeout: 20000 }): Promise<T> {
  const started = performance.now();
  let bodyFinished: number | undefined;
  return timeBooking('db.transaction', async () => {
    try {
      return await db.$transaction(async tx => {
        // Includes pool acquisition and BEGIN; not a pure pool-wait measurement.
        recordBookingTiming('db.acquire_and_begin', performance.now() - started);
        try { return await timeBooking('db.transaction_body', () => work(timedDatabase(tx))); }
        finally { bodyFinished = performance.now(); }
      }, options);
    } finally {
      if (bodyFinished !== undefined) recordBookingTiming('db.commit_or_rollback', performance.now() - bodyFinished);
    }
  });
}
