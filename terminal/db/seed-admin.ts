import "dotenv/config";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    console.error("Set ADMIN_EMAIL in .env before running the seed script.");
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = randomBytes(9).toString("base64url");
    generated = true;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      console.log(`Admin user ${email} already exists — nothing to do.`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, $2, $3, 'admin')`,
      [email, passwordHash, "Admin"]
    );

    console.log(`Bootstrap admin created: ${email}`);
    if (generated) {
      console.log(`Generated password (save this now, it will not be shown again): ${password}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
