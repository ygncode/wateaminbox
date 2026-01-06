Issue

--> POST /api/quick-replies 500 41ms
[02:33:00] ERROR: [App] Unexpected error
module: "App"
path: "/api/quick-replies"
err: {
"type": "Object",
"message": "column \"title\" of relation \"quick_replies\" does not exist",
"stack":
error: column "title" of relation "quick_replies" does not exist
at <anonymous> (/Users/setkyar/ygncode-lab/whatsapp-web/node_modules/pg/lib/client.js:545:17)
at processTicksAndRejections (native:7:39)
at executeQuery (/Users/setkyar/ygncode-lab/whatsapp-web/node_modules/kysely/dist/esm/dialect/postgres/postgres-driver.js:102:41)
at processTicksAndRejections (native:7:39)
"name": "error",
"code": "42703"
}

the UI is ugly check - .prompts/screenshots/quick-reply.png, help me inspire from Add New Contact and fix the UI.

Make sure to write test.
