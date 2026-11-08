import { createQaHandler, createQaServices } from './handler.js';

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function defaultKey(mapName: string, legacyName: string): string {
  const keys = Deno.env.get(mapName);
  const key = keys ? JSON.parse(keys)?.default : undefined;
  return typeof key === 'string' && key ? key : requiredEnv(legacyName);
}

const services = createQaServices({
  supabaseUrl: requiredEnv('SUPABASE_URL'),
  databaseKey: defaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'),
  publishableKey: defaultKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'),
  turnstileSecret: requiredEnv('TURNSTILE_SECRET_KEY'),
});

Deno.serve(createQaHandler({
  ...services,
  allowedOrigin: requiredEnv('QA_ALLOWED_ORIGIN'),
  ownerId: requiredEnv('QA_OWNER_ID'),
}));
