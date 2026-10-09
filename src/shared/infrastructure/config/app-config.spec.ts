import { InvalidConfigError, parseConfig } from './app-config';

const validEnv = {
  DATABASE_URL: 'postgres://tramo:tramo@localhost:5432/tramo',
  REDIS_URL: 'redis://localhost:6379',
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

  it('should ignore pretty logging when running in production', () => {
    const config = parseConfig({ ...validEnv, NODE_ENV: 'production', LOG_PRETTY: 'true' });

    expect(config.log.pretty).toBe(false);
  });
});
