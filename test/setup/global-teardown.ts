export default async function globalTeardown(): Promise<void> {
  const infra = globalThis.__TRAMO_INFRA__;
  if (infra) {
    await Promise.all([infra.postgres.stop(), infra.redis.stop()]);
  }
}
