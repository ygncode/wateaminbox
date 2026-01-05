import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Migration 018: Add name column to users table
 *
 * PURPOSE:
 * Add a name column to the users table to store the user's display name
 * collected during registration. This enables showing user names instead
 * of email addresses throughout the application.
 *
 * CHANGES:
 * 1. Add name column to users table (varchar 255, nullable)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  console.log("Adding name column to users table...");

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS name VARCHAR(255)
  `.execute(db);

  console.log("Name column added to users table successfully!");
}

export async function down(db: Kysely<unknown>): Promise<void> {
  console.log("Removing name column from users table...");

  await sql`
    ALTER TABLE users
    DROP COLUMN IF EXISTS name
  `.execute(db);

  console.log("Name column removed from users table.");
}
