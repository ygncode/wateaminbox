import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  batchStarSchema,
  listMessagesQuerySchema,
  scheduleMessageSchema,
  sendMessageSchema,
} from "../../lib/schemas/message.js";
import { pushSubscriptionSchema } from "../../lib/schemas/push-subscription.js";
import { readTools } from "./tools/read.js";
import { writeTools } from "./tools/write.js";

test("SDK initialization's unconstrained icon arrays remain a documented residual risk", () => {
  for (const icons of [
    Array(100).fill(null),
    [{ src: "https://example.com/icon", sizes: Array(100).fill(null) }],
  ]) {
    const result = InitializeRequestSchema.safeParse({
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0", icons },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(100);
  }
});

// Exercise the SDK's actual v4-mini path, not only application safeParse.
test("every MCP tool's migrated input schema can be advertised by the SDK", () => {
  for (const tool of [...readTools, ...writeTools]) {
    const jsonSchema = toJsonSchemaCompat(z.object(tool.inputSchema));
    expect(jsonSchema.type).toBe("object");
    expect(Object.keys(jsonSchema.properties ?? {}).sort()).toEqual(
      Object.keys(tool.inputSchema).sort(),
    );
  }
});

test("tools/list preserves actual integer offsets and scheduling format metadata", async () => {
  const server = new McpServer({ name: "metadata-test", version: "1.0.0" });
  const client = new Client({ name: "metadata-test", version: "1.0.0" });
  const tools = [...readTools, ...writeTools];
  for (const tool of tools) {
    // Advertise the real tool schemas without invoking application services.
    server.registerTool(
      tool.name,
      { inputSchema: z.object(tool.inputSchema) },
      async () => ({ content: [] }),
    );
  }
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    for (const name of [
      "list_conversations",
      "list_contacts",
      "list_contact_notes",
      "list_broadcasts",
      "list_quick_replies",
    ]) {
      const advertised = listed.tools.find((tool) => tool.name === name);
      const schema = tools.find((tool) => tool.name === name)?.inputSchema
        .offset;
      if (!advertised || !schema)
        throw new Error(`Missing offset schema: ${name}`);
      expect(advertised.inputSchema.properties?.offset).toMatchObject({
        type: "integer",
        minimum: 0,
      });
      expect(advertised.inputSchema.properties?.offset).not.toHaveProperty(
        "maximum",
      );
      expect(advertised.inputSchema.required ?? []).not.toContain("offset");
      if (name === "list_quick_replies")
        expect(advertised.inputSchema.properties?.offset).toHaveProperty(
          "default",
          0,
        );
      expect(z.core.parse(schema, 2 ** 53)).toBe(2 ** 53);
      expect(z.core.safeParse(schema, 1.5).success).toBe(false);
      expect(z.core.safeParse(schema, -1).success).toBe(false);
    }
    for (const name of ["schedule_message", "create_broadcast"]) {
      const advertised = listed.tools.find((tool) => tool.name === name);
      const schema = tools.find((tool) => tool.name === name)?.inputSchema
        .scheduledAt;
      if (!advertised || !schema)
        throw new Error(`Missing scheduling schema: ${name}`);
      expect(advertised.inputSchema.properties?.scheduledAt).toMatchObject({
        type: "string",
        format: "date-time",
        pattern: expect.any(String),
        description: expect.any(String),
      });
      expect(advertised.inputSchema.required).toContain("scheduledAt");
      expect(z.core.parse(schema, "2030-01-02T12:34+0630")).toBe(
        "2030-01-02T12:34+0630",
      );
      expect(z.core.safeParse(schema, "2030-02-30T12:34Z").success).toBe(false);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("SDK conversion retains URI and UTC datetime metadata through optional fields", () => {
  // These shared REST schemas are not currently exposed as MCP media tools.
  // Check the actual SDK converter so future reuse does not silently lose hints.
  for (const schema of [sendMessageSchema, scheduleMessageSchema]) {
    expect(toJsonSchemaCompat(schema)).toMatchObject({
      properties: { mediaUrl: { type: "string", format: "uri" } },
    });
  }
  expect(toJsonSchemaCompat(pushSubscriptionSchema)).toMatchObject({
    properties: {
      endpoint: { type: "string", format: "uri", maxLength: 4096 },
    },
  });
  for (const field of ["before", "after"]) {
    expect(toJsonSchemaCompat(listMessagesQuerySchema)).toMatchObject({
      properties: {
        [field]: {
          type: "string",
          format: "date-time",
          pattern: expect.any(String),
        },
      },
    });
  }
});

test("MCP SDK validates Zod 4 bounds and GUIDs before invoking a handler", async () => {
  const server = new McpServer({ name: "validation-test", version: "1.0.0" });
  const client = new Client({ name: "validation-test", version: "1.0.0" });
  let handlerCalls = 0;
  server.registerTool(
    "batch",
    { inputSchema: batchStarSchema.shape },
    async (args) => {
      handlerCalls++;
      return { content: [{ type: "text", text: JSON.stringify(args) }] };
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["batch"]);
    const invalid = await client.callTool({
      name: "batch",
      arguments: { messageIds: Array(10_000).fill(null) },
    });
    expect(invalid.isError).toBe(true);
    expect(handlerCalls).toBe(0);
    // One collection issue, not 10,000 serialized element issues.
    expect(JSON.stringify(invalid).length).toBeLessThan(1500);
    const messageIds = Array(50).fill("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const valid = await client.callTool({
      name: "batch",
      arguments: { messageIds },
    });
    expect(valid.isError).not.toBe(true);
    expect(handlerCalls).toBe(1);
    expect(valid.content).toEqual([
      { type: "text", text: JSON.stringify({ messageIds, star: true }) },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
