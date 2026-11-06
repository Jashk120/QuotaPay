import { neon } from "@neondatabase/serverless";

let client: ReturnType<typeof neon> | null = null;

/** Lazy neon http client. Throws when DATABASE_URL is missing. */
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!client) client = neon(url);
  return client;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Connection string the worker should use: least-privilege role first. */
export function workerDbUrl(): string | null {
  return process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL || null;
}
