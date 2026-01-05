I refresh the db by running scripts/clean-db.sh and register. I am seeing this error

```
--> GET /api/notifications 200 24ms
error: column "message_type" does not exist
--> GET /api/contacts?includeGroups=true&limit=100 500 19ms
--> GET /api/notifications/count 200 20ms
[WS] Message received before initialization
<-- GET /api/contacts?includeGroups=true&limit=100
error: column "message_type" does not exist
--> GET /api/contacts?includeGroups=true&limit=100 500 13ms
```

help me check and fix.
