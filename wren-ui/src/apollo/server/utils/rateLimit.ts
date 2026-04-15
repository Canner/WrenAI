import { NextApiRequest, NextApiResponse } from 'next';
import type { Knex } from 'knex';
import { getConfig } from '@server/config';
import { bootstrapKnex } from './knex';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  remaining?: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    options: { windowMs: number; max: number },
  ): Promise<RateLimitResult>;
}

type MemoryBucket = {
  count: number;
  resetAt: number;
};

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, MemoryBucket>();

  public async consume(
    key: string,
    options: { windowMs: number; max: number },
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });

      return {
        allowed: true,
        remaining: Math.max(options.max - 1, 0),
      };
    }

    if (current.count >= options.max) {
      return {
        allowed: false,
        retryAfterMs: Math.max(current.resetAt - now, 0),
        remaining: 0,
      };
    }

    current.count += 1;
    this.buckets.set(key, current);

    return {
      allowed: true,
      remaining: Math.max(options.max - current.count, 0),
    };
  }
}

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(
    private readonly knex: Knex,
    private readonly fallbackStore: RateLimitStore = new MemoryRateLimitStore(),
  ) {}

  public async consume(
    key: string,
    options: { windowMs: number; max: number },
  ): Promise<RateLimitResult> {
    try {
      return await this.knex.transaction(async (tx) => {
        const now = new Date();
        const resetAt = new Date(now.getTime() + options.windowMs);
        const current = await tx('rate_limit_bucket')
          .where({ key })
          .forUpdate()
          .first();

        if (!current || new Date(current.reset_at).getTime() <= now.getTime()) {
          await tx('rate_limit_bucket')
            .insert({
              key,
              count: 1,
              reset_at: resetAt,
            })
            .onConflict('key')
            .merge({
              count: 1,
              reset_at: resetAt,
              updated_at: now,
            });

          return {
            allowed: true,
            remaining: Math.max(options.max - 1, 0),
          };
        }

        if (current.count >= options.max) {
          return {
            allowed: false,
            retryAfterMs: Math.max(
              new Date(current.reset_at).getTime() - now.getTime(),
              0,
            ),
            remaining: 0,
          };
        }

        const nextCount = current.count + 1;
        await tx('rate_limit_bucket')
          .where({ key })
          .update({
            count: nextCount,
            updated_at: now,
          });

        return {
          allowed: true,
          remaining: Math.max(options.max - nextCount, 0),
        };
      });
    } catch {
      return this.fallbackStore.consume(key, options);
    }
  }
}

const globalForRateLimit = globalThis as typeof globalThis & {
  __wrenMemoryRateLimitStore__?: MemoryRateLimitStore;
  __wrenPostgresRateLimitStore__?: PostgresRateLimitStore;
};

export const defaultRateLimitStore =
  globalForRateLimit.__wrenMemoryRateLimitStore__ || new MemoryRateLimitStore();

if (process.env.NODE_ENV !== 'production') {
  globalForRateLimit.__wrenMemoryRateLimitStore__ = defaultRateLimitStore;
}

const resolveDefaultRateLimitStore = () => {
  if (globalForRateLimit.__wrenPostgresRateLimitStore__) {
    return globalForRateLimit.__wrenPostgresRateLimitStore__;
  }

  const config = getConfig();
  if (!config.pgUrl) {
    return defaultRateLimitStore;
  }

  try {
    const knex = bootstrapKnex({
      pgUrl: config.pgUrl,
      debug: config.debug,
    });
    const store = new PostgresRateLimitStore(knex, defaultRateLimitStore);
    globalForRateLimit.__wrenPostgresRateLimitStore__ = store;
    return store;
  } catch {
    return defaultRateLimitStore;
  }
};

export const sharedRateLimitStore = resolveDefaultRateLimitStore();

export const getRequestIpAddress = (req: NextApiRequest) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor;

  if (forwardedValue) {
    return forwardedValue.split(',')[0]?.trim() || 'unknown-ip';
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] || 'unknown-ip' : realIp;
  }

  return req.socket?.remoteAddress || 'unknown-ip';
};

const buildRetryAfterSeconds = (retryAfterMs?: number) =>
  Math.max(Math.ceil((retryAfterMs || 0) / 1000), 1);

export const enforceRateLimit = async ({
  req,
  res,
  store = sharedRateLimitStore,
  endpoint,
  email,
  rules,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
  store?: RateLimitStore;
  endpoint: string;
  email?: string | null;
  rules: Array<{
    kind: 'ip' | 'email';
    windowMs: number;
    max: number;
  }>;
}) => {
  const ip = getRequestIpAddress(req);

  for (const rule of rules) {
    const identity =
      rule.kind === 'email'
        ? `${email || 'anonymous-email'}`.trim().toLowerCase()
        : ip;

    const result = await store.consume(
      `${endpoint}:${rule.kind}:${identity}`,
      rule,
    );

    if (!result.allowed) {
      res.setHeader(
        'Retry-After',
        `${buildRetryAfterSeconds(result.retryAfterMs)}`,
      );
      const error =
        rule.kind === 'email'
          ? 'Too many attempts for this account. Please try again later.'
          : 'Too many requests. Please try again later.';
      return {
        limited: true,
        response: res.status(429).json({
          error,
          retryAfterMs: result.retryAfterMs || 0,
        }),
      };
    }
  }

  return {
    limited: false,
  };
};
