// Accounts of the demo data set, one per role. The seed creates them and the try-endpoint skill
// signs in with them, so both read this one list. Local and demo use only.
export const DEMO_PASSWORD = 'tramo demo password';

export const DEMO_USERS = {
  admin: 'admin@tramo.test',
  ops: 'ops@tramo.test',
  center: 'admin@codeworks.test',
  student: 'ana.garcia@example.com',
} as const;

export type DemoRole = keyof typeof DEMO_USERS;

export const isDemoRole = (value: string): value is DemoRole => value in DEMO_USERS;
