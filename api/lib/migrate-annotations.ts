import { Client } from "pg";

/**
 * Idempotently add the `runs.annotationsJson` column on databases that predate
 * the slide-annotation feature. Without it, completing a play that carries
 * freehand marks would fail to save. Safe to call repeatedly; best-effort at
 * server boot (never blocks startup).
 */
export async function ensureRunAnnotationsColumn(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Only act if the runs table already exists (fresh installs create it with
    // the column from the schema).
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sketchlearn' AND table_name = 'runs'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(
      `ALTER TABLE sketchlearn.runs ADD COLUMN IF NOT EXISTS "annotationsJson" json`,
    );
  } finally {
    await client.end();
  }
}
