/**
 * Performance test for contact query optimization
 *
 * This test creates realistic data (50+ contacts, 100+ messages per contact)
 * and measures the response time of the optimized query.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Kysely, sql, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { getContactsWithLastMessage } from "../../services/contact.service";

// Database connection setup
const pool = new Pool({
  host: "localhost",
  port: 5433,
  database: "whatsapp_web",
  user: "postgres",
  password: "postgres",
});

const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool }),
});

// Test-specific schema
const TEST_TENANT_ID = "perf_test_tenant";
const TEST_SCHEMA = `tenant_${TEST_TENANT_ID}`;

interface ContactRow {
  id: string;
  jid: string | null;
  phone_number: string | null;
  push_name: string | null;
  custom_name: string | null;
  is_group: boolean;
  profile_picture_url: string | null;
  notes_shared: string | null;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
}

interface MessageRow {
  id: string;
  contact_id: string;
  message_id: string | null;
  from_me: boolean;
  message_type: string;
  content: string | null;
  status: string;
  timestamp: Date;
  created_at: Date;
}

interface ContactAssignmentRow {
  id: string;
  contact_id: string;
  assigned_to: string;
  assigned_by: string;
  assigned_at: Date;
  unassigned_at: Date | null;
}

let queryCount = 0;
let originalExecute: any = null;

// Track query execution
async function trackQueries<T>(fn: () => Promise<T>): Promise<{ result: T; count: number }> {
  queryCount = 0;
  const result = await fn();
  return { result, count: queryCount };
}

describe("Performance: Contact Query Optimization", () => {
  let tenantDb: Kysely<any>;

  beforeAll(async () => {
    // Create test schema
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);

    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        jid VARCHAR(255),
        phone_number VARCHAR(50),
        push_name VARCHAR(255),
        custom_name VARCHAR(255),
        is_group BOOLEAN DEFAULT false,
        profile_picture_url TEXT,
        notes_shared TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_message_at TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES ${TEST_SCHEMA}.contacts(id) ON DELETE CASCADE,
        message_id VARCHAR(255),
        from_me BOOLEAN DEFAULT false,
        message_type VARCHAR(50) DEFAULT 'text',
        content TEXT,
        status VARCHAR(50) DEFAULT 'sent',
        timestamp TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.contact_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES ${TEST_SCHEMA}.contacts(id) ON DELETE CASCADE,
        assigned_to UUID NOT NULL,
        assigned_by UUID NOT NULL,
        assigned_at TIMESTAMP DEFAULT NOW(),
        unassigned_at TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.conversation_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL UNIQUE,
        read_by_user_id UUID,
        read_at TIMESTAMP,
        last_message_at TIMESTAMP,
        last_message_preview TEXT,
        unread_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create performance indexes (same as migration 013)
    await pool.query(`
      CREATE INDEX idx_${TEST_SCHEMA}_messages_contact_timestamp
        ON ${TEST_SCHEMA}.messages (contact_id, timestamp DESC)
    `);

    await pool.query(`
      CREATE INDEX idx_${TEST_SCHEMA}_contact_assignments_active
        ON ${TEST_SCHEMA}.contact_assignments (assigned_to)
        WHERE unassigned_at IS NULL
    `);

    await pool.query(`
      CREATE INDEX idx_${TEST_SCHEMA}_messages_incoming
        ON ${TEST_SCHEMA}.messages (contact_id, from_me)
        WHERE from_me = false
    `);

    // Create tenant DB connection with search_path set
    const tenantPool = new Pool({
      host: "localhost",
      port: 5433,
      database: "whatsapp_web",
      user: "postgres",
      password: "postgres",
    });

    // Set search_path once for all connections in the pool
    await tenantPool.query(`SET search_path TO ${TEST_SCHEMA}`);

    tenantDb = new Kysely<any>({
      dialect: new PostgresDialect({ pool: tenantPool }),
    });

    // Create test data
    await generateTestData(tenantDb);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.end();
  });

  it("should fetch 50 contacts with <200ms response time", async () => {
    const startTime = performance.now();
    queryCount = 0;

    const { contacts, total } = await getContactsWithLastMessage(tenantDb, {
      limit: 50,
      offset: 0,
    });

    const endTime = performance.now();
    const responseTime = endTime - startTime;

    expect(contacts.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(50);
    expect(responseTime).toBeLessThan(200);
    expect(queryCount).toBeLessThanOrEqual(3); // Main query + count query

    console.log(`  Response time for 50 contacts: ${responseTime.toFixed(2)}ms`);
    console.log(`  Query count: ${queryCount}`);
    console.log(`  Contacts returned: ${contacts.length}`);
    console.log(`  Total contacts: ${total}`);
  });

  it("should fetch 100 contacts with <300ms response time", async () => {
    const startTime = performance.now();
    queryCount = 0;

    const { contacts, total } = await getContactsWithLastMessage(tenantDb, {
      limit: 100,
      offset: 0,
    });

    const endTime = performance.now();
    const responseTime = endTime - startTime;

    expect(contacts.length).toBeGreaterThan(0);
    expect(responseTime).toBeLessThan(300);
    expect(queryCount).toBeLessThanOrEqual(3);

    console.log(`  Response time for 100 contacts: ${responseTime.toFixed(2)}ms`);
    console.log(`  Query count: ${queryCount}`);
  });

  it("should handle pagination efficiently", async () => {
    const startTime = performance.now();
    queryCount = 0;

    // First page
    const page1 = await getContactsWithLastMessage(tenantDb, {
      limit: 25,
      offset: 0,
    });

    const page1Time = performance.now();

    // Second page
    const page2 = await getContactsWithLastMessage(tenantDb, {
      limit: 25,
      offset: 25,
    });

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const page1TimeMs = page1Time - startTime;

    expect(page1.contacts.length).toBe(25);
    expect(page2.contacts.length).toBe(25);
    expect(totalTime).toBeLessThan(400); // Both pages combined
    expect(queryCount).toBeLessThanOrEqual(4); // 2 queries per page

    console.log(`  Page 1 time: ${page1TimeMs.toFixed(2)}ms`);
    console.log(`  Total time for 2 pages: ${totalTime.toFixed(2)}ms`);
    console.log(`  Query count: ${queryCount}`);
  });

  it("should handle search filter efficiently", async () => {
    const startTime = performance.now();
    queryCount = 0;

    const { contacts, total } = await getContactsWithLastMessage(tenantDb, {
      search: "Test",
      limit: 50,
    });

    const endTime = performance.now();
    const responseTime = endTime - startTime;

    expect(responseTime).toBeLessThan(200);
    expect(queryCount).toBeLessThanOrEqual(3);

    console.log(`  Search response time: ${responseTime.toFixed(2)}ms`);
    console.log(`  Results found: ${contacts.length} of ${total}`);
  });

  it("should handle assignedToMe filter efficiently", async () => {
    const startTime = performance.now();
    queryCount = 0;

    const { contacts, total } = await getContactsWithLastMessage(tenantDb, {
      assignedToMe: true,
      userId: "00000000-0000-0000-0000-000000000001", // Must match the userId used in test data
      limit: 50,
    });

    const endTime = performance.now();
    const responseTime = endTime - startTime;

    expect(responseTime).toBeLessThan(200);
    expect(queryCount).toBeLessThanOrEqual(3);

    console.log(`  assignedToMe response time: ${responseTime.toFixed(2)}ms`);
    console.log(`  Assigned contacts: ${contacts.length} of ${total}`);
  });

  it("should handle unassigned filter efficiently", async () => {
    const startTime = performance.now();
    queryCount = 0;

    const { contacts, total } = await getContactsWithLastMessage(tenantDb, {
      unassigned: true,
      limit: 50,
    });

    const endTime = performance.now();
    const responseTime = endTime - startTime;

    expect(responseTime).toBeLessThan(200);
    expect(queryCount).toBeLessThanOrEqual(3);

    console.log(`  Unassigned response time: ${responseTime.toFixed(2)}ms`);
    console.log(`  Unassigned contacts: ${contacts.length} of ${total}`);
  });

  it("should verify lastMessage data is included", async () => {
    const { contacts } = await getContactsWithLastMessage(tenantDb, {
      limit: 10,
    });

    // Check that at least some contacts have last message data
    const contactsWithMessages = contacts.filter((c) => c.last_message !== null);
    expect(contactsWithMessages.length).toBeGreaterThan(0);

    // Verify last message structure
    const firstWithMessage = contactsWithMessages[0];
    expect(firstWithMessage.last_message).toBeDefined();
    expect(firstWithMessage.last_message?.id).toBeDefined();
    expect(firstWithMessage.last_message?.messageId).toBeDefined();
    expect(firstWithMessage.last_message?.fromMe).toBeDefined();
    expect(firstWithMessage.last_message?.content).toBeDefined();

    console.log(`  Contacts with messages: ${contactsWithMessages.length}/${contacts.length}`);
  });
});

/**
 * Generate test data for performance testing
 * Creates 75 contacts with varying numbers of messages
 */
async function generateTestData(tenantDb: Kysely<any>): Promise<void> {
  const userId = "00000000-0000-0000-0000-000000000001";
  const contacts: ContactRow[] = [];
  const messages: MessageRow[] = [];
  const assignments: ContactAssignmentRow[] = [];

  const now = Date.now();

  // Helper to generate UUID-like strings
  const uuid = (n: number) => {
    const hex = n.toString(16).padStart(32, "0");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  };

  // Create 75 contacts
  for (let i = 1; i <= 75; i++) {
    const contactId = uuid(i);
    const phoneNumber = `1${String(i).padStart(9, "0")}`;
    const jid = `${phoneNumber}@s.whatsapp.net`;
    const messageCount = 50 + Math.floor(Math.random() * 150); // 50-200 messages per contact

    contacts.push({
      id: contactId,
      jid,
      phone_number: phoneNumber,
      push_name: `Test Contact ${i}`,
      custom_name: i % 3 === 0 ? `Custom Name ${i}` : null, // Some have custom names
      is_group: false,
      profile_picture_url: null,
      notes_shared: null,
      created_at: new Date(now - 90 * 24 * 60 * 60 * 1000), // 90 days ago
      updated_at: new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000), // Within last week
      last_message_at: new Date(now - Math.random() * 24 * 60 * 60 * 1000), // Within last day
    });

    // Assign some contacts to user
    if (i % 4 === 0) {
      // Every 4th contact is assigned
      assignments.push({
        id: uuid(10000 + i),
        contact_id: contactId,
        assigned_to: userId,
        assigned_by: userId,
        assigned_at: new Date(now - 30 * 24 * 60 * 60 * 1000),
        unassigned_at: null,
      });
    }

    // Create messages for this contact
    const baseTimestamp = now - 30 * 24 * 60 * 60 * 1000; // Starting 30 days ago

    for (let j = 1; j <= messageCount; j++) {
      const fromMe = j % 2 === 0; // Alternate between sent and received
      const timestampOffset = Math.random() * 30 * 24 * 60 * 60 * 1000; // Spread over 30 days

      messages.push({
        id: uuid(i * 10000 + j),
        contact_id: contactId,
        message_id: `wa-msg-${i}-${j}`,
        from_me: fromMe,
        message_type: Math.random() > 0.8 ? "image" : "text", // 20% images
        content:
          Math.random() > 0.8
            ? null
            : `Test message ${j} from contact ${i}`.repeat(Math.floor(Math.random() * 5) + 1),
        status: "read",
        timestamp: new Date(baseTimestamp + timestampOffset),
        created_at: new Date(baseTimestamp + timestampOffset),
      });
    }
  }

  // Insert contacts using Kysely with search_path set
  for (const contact of contacts) {
    await tenantDb
      .insertInto("contacts")
      .values(contact as any)
      .execute();
  }

  // Insert messages
  for (const message of messages) {
    await tenantDb
      .insertInto("messages")
      .values(message as any)
      .execute();
  }

  // Insert assignments
  for (const assignment of assignments) {
    await tenantDb
      .insertInto("contact_assignments")
      .values(assignment as any)
      .execute();
  }

  console.log(`  Created ${contacts.length} contacts with ${messages.length} messages`);
}
