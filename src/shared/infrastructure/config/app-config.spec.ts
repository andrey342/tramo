import { InvalidConfigError, parseConfig } from './app-config';

const validEnv = {
  DATABASE_URL: 'postgres://tramo:tramo@localhost:5432/tramo',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('parseConfig', () => {
  it('should apply defaults when optional variables are missing', () => {
    const config = parseConfig(validEnv);

    expect(config.env).toBe('development');
    expect(config.http.port).toBe(3000);
    expect(config.http.corsOrigins).toEqual([]);
    expect(config.docs.enabled).toBe(true);
    expect(config.database.poolMax).toBe(10);
  });

  it('should coerce numbers, booleans and lists when provided as strings', () => {
    const config = parseConfig({
      ...validEnv,
      PORT: '8080',
      SWAGGER_ENABLED: 'false',
      CORS_ORIGINS: 'http://a.test, http://b.test,',
    });

    expect(config.http.port).toBe(8080);
    expect(config.docs.enabled).toBe(false);
    expect(config.http.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('should fail fast when a required variable is missing', () => {
    expect(() => parseConfig({ REDIS_URL: validEnv.REDIS_URL })).toThrow(InvalidConfigError);
  });

  it('should reject a database url with the wrong scheme', () => {
    expect(() => parseConfig({ ...validEnv, DATABASE_URL: 'mysql://localhost/tramo' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('should treat an empty dashboard password as not configured', () => {
    expect(parseConfig({ ...validEnv, BULL_BOARD_PASSWORD: '' }).queueDashboard.password).toBe(
      undefined,
    );
  });

  it('should refuse the published development secrets in production', () => {
    const production = { ...validEnv, NODE_ENV: 'production' };

    expect(() =>
      parseConfig({
        ...production,
        JWT_ACCESS_SECRET: 'local-development-secret-change-me-0123456789',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseConfig({ ...production, BULL_BOARD_PASSWORD: 'tramo-queues' })).toThrow(
      /BULL_BOARD_PASSWORD/,
    );
    expect(() =>
      parseConfig({
        ...production,
        FIELD_ENCRYPTION_KEY: 'K0ZDSqr9YOcVMSLG1k4+T3Ie9/nmSDRZDMoifZ6VyIU=',
      }),
    ).toThrow(/FIELD_ENCRYPTION_KEY/);
    expect(
      parseConfig({
        ...validEnv,
        JWT_ACCESS_SECRET: 'local-development-secret-change-me-0123456789',
      }).env,
    ).toBe('development');
  });

  it('should serve the API docs by default everywhere but production', () => {
    expect(parseConfig(validEnv).docs.enabled).toBe(true);
    expect(parseConfig({ ...validEnv, NODE_ENV: 'production' }).docs.enabled).toBe(false);
    expect(
      parseConfig({ ...validEnv, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).docs.enabled,
    ).toBe(true);
  });

  it('should refuse a VAT check that is not VIES itself in production', () => {
    const production = { ...validEnv, NODE_ENV: 'production' };

    expect(() => parseConfig({ ...production, VIES_MODE: 'fake' })).toThrow(/VIES_MODE/);
    expect(() => parseConfig({ ...production, VIES_MODE: 'test' })).toThrow(/VIES_MODE/);
    expect(parseConfig({ ...production, VIES_MODE: 'live' }).vies.mode).toBe('live');
    expect(parseConfig({ ...validEnv, VIES_MODE: 'fake' }).vies.mode).toBe('fake');
  });

  it('should require a field encryption key of exactly 32 bytes', () => {
    expect(() => parseConfig({ ...validEnv, FIELD_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
  });

  it('should ignore pretty logging when running in production', () => {
    const config = parseConfig({ ...validEnv, NODE_ENV: 'production', LOG_PRETTY: 'true' });

    expect(config.log.pretty).toBe(false);
  });
});
