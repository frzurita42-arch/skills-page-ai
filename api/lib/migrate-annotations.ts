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

/**
 * Idempotently add the commercial-marketplace pieces on older databases: the
 * public contact columns on users, and the orders (interest) table. Best-effort
 * at boot; safe to call repeatedly.
 */
export async function ensureCommercialSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sketchlearn' AND table_name = 'users'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "whatsapp" varchar(40)`,
    );
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "contactNote" varchar(500)`,
    );
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "socials" json`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn.orders (
         id serial PRIMARY KEY,
         "repoId" integer NOT NULL,
         "lessonId" integer,
         "ownerId" integer,
         "buyerUserId" integer,
         "buyerName" varchar(255) NOT NULL DEFAULT 'Guest',
         "itemTitle" varchar(255),
         note varchar(1000),
         seen boolean NOT NULL DEFAULT false,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS orders_owner_idx ON sketchlearn.orders ("ownerId")`,
    );
  } finally {
    await client.end();
  }
}
