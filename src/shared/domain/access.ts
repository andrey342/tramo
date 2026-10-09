// Vocabulary of access control shared by every module: who a user is (role) and what a training
// center's API key may do (scope). Authorization decisions live in each module's use cases.
export const ROLES = ['student', 'center_admin', 'ops', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const API_KEY_SCOPES = [
  'applications:read',
  'applications:write',
  'programs:read',
  'programs:write',
  'portfolio:read',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);

export const isApiKeyScope = (value: string): value is ApiKeyScope =>
  (API_KEY_SCOPES as readonly string[]).includes(value);
