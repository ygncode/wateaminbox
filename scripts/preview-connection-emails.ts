import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { renderConnectionAlertEmail } from "../apps/api/src/lib/connection-alert-email.js";

// Render only: this script never imports a mail driver or contacts a provider.
const output = resolve(import.meta.dir, "../.temp/connection-email-previews");
await mkdir(output, { recursive: true });
await copyFile(
  resolve(import.meta.dir, "../apps/web/public/favicon-96x96.png"),
  `${output}/favicon-96x96.png`,
);
for (const kind of ["logged_out", "disconnected"] as const) {
  const email = renderConnectionAlertEmail({
    kind,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    workspaceName: "Acme Support",
    connectionName: "Customer support",
    occurredAt: new Date("2026-09-07T01:30:03Z"),
  });
  await Bun.write(`${output}/${kind}.html`, email.html);
  await Bun.write(
    `${output}/${kind}.txt`,
    `Subject: ${email.subject}\n\n${email.text}\n`,
  );
  console.log(`${kind}: ${output}/${kind}.html`);
}
