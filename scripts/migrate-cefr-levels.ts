import "dotenv/config";
import { Client } from "pg";

/**
 * One-time migration: convert the `level` enum from the old 3-tier scale
 * (beginner/intermediate/advanced) to the CEFR scale (A0, A1, A2, B1, B2,
 * C1, C2). Existing rows are preserved by RENAMING the old values:
 *   beginner -> A1, intermediate -> B1, advanced -> C1
 * then the remaining CEFR values (A0, A2, B2, C2) are added.
 *
 * Idempotent: safe to run more than once. Uses ALTER TYPE ... RENAME VALUE /
 * ADD VALUE, each guarded so a partially-applied migration can be resumed.
 *
 * Run: npx tsx scripts/migrate-cefr-levels.ts   (or: node --import tsx ...)
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString });
  await client.connect();

  const schema = "sketchlearn";
  const typeName = `${schema}.level`;

  // current enum labels
  const { rows } = await client.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'level' AND n.nspname = $1
      ORDER BY e.enumsortorder`,
    [schema],
  );
  const labels = new Set(rows.map((r) => r.label));
  console.log("current level labels:", [...labels].join(", ") || "(none)");

  const rename = async (from: string, to: string) => {
    if (labels.has(from) && !labels.has(to)) {
      await client.query(`ALTER TYPE ${typeName} RENAME VALUE '${from}' TO '${to}'`);
      labels.delete(from);
      labels.add(to);
      console.log(`renamed ${from} -> ${to}`);
    }
  };
  const add = async (value: string) => {
    if (!labels.has(value)) {
      // ADD VALUE cannot run inside a transaction block; pg runs statements
      // auto-committed here since we don't BEGIN one.
      await client.query(`ALTER TYPE ${typeName} ADD VALUE IF NOT EXISTS '${value}'`);
      labels.add(value);
      console.log(`added ${value}`);
    }
  };

  await rename("beginner", "A1");
  await rename("intermediate", "B1");
  await rename("advanced", "C1");
  for (const v of ["A0", "A1", "A2", "B1", "B2", "C1", "C2"]) await add(v);

  await client.end();
  console.log("CEFR level migration complete:", [...labels].sort().join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
