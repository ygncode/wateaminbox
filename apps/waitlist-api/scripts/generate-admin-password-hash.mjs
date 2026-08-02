import { pbkdf2Sync, randomBytes } from "node:crypto";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.from(chunk));
}

const password = Buffer.concat(chunks);
if (password.length === 0) {
  console.error(
    "Read an admin password from standard input; do not pass it as a command-line argument.",
  );
  process.exit(1);
}

// Cloudflare Workers Web Crypto supports PBKDF2 up to 100,000 iterations.
const iterations = 100_000;
const salt = randomBytes(16);
const digest = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const base64url = (value) => value.toString("base64url");

process.stdout.write(
  `pbkdf2_sha256$${iterations}$${base64url(salt)}$${base64url(digest)}\n`,
);
