import { MeiliSearch, Index } from "meilisearch";
import { createLogger, formatError } from "../lib/logger.js";

const logger = createLogger("Meilisearch");

/**
 * Meilisearch configuration
 */
const MEILISEARCH_URL = process.env.MEILISEARCH_URL || "http://localhost:7700";
const MEILISEARCH_API_KEY =
  process.env.MEILISEARCH_API_KEY || "development_master_key";

/**
 * Singleton Meilisearch client
 */
let client: MeiliSearch | null = null;

/**
 * Get or create Meilisearch client
 */
export function getMeilisearchClient(): MeiliSearch {
  if (!client) {
    client = new MeiliSearch({
      host: MEILISEARCH_URL,
      apiKey: MEILISEARCH_API_KEY,
    });
  }
  return client;
}

/**
 * Check if Meilisearch is available
 */
export async function isMeilisearchAvailable(): Promise<boolean> {
  try {
    const meili = getMeilisearchClient();
    await meili.health();
    return true;
  } catch {
    return false;
  }
}

/**
 * Message document for Meilisearch indexing
 */
export interface MessageDocument {
  id: string;
  companyId: string;
  contactId: string;
  contactName: string | null;
  contactJid: string | null;
  isGroup: boolean;
  messageId: string | null;
  content: string | null;
  messageType: string | null;
  timestamp: number; // Unix timestamp for filtering
  fromMe: boolean;
}

/**
 * Contact document for Meilisearch indexing
 */
export interface ContactDocument {
  id: string;
  companyId: string;
  jid: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  customName: string | null;
  displayName: string;
  isGroup: boolean;
  notesShared: string | null;
}

/**
 * Get messages index name for a company
 */
export function getMessagesIndexName(companyId: string): string {
  return `messages_${companyId.replace(/-/g, "_")}`;
}

/**
 * Get contacts index name for a company
 */
export function getContactsIndexName(companyId: string): string {
  return `contacts_${companyId.replace(/-/g, "_")}`;
}

/**
 * Initialize or get messages index for a company
 */
export async function getMessagesIndex(
  companyId: string,
): Promise<Index<MessageDocument>> {
  const meili = getMeilisearchClient();
  const indexName = getMessagesIndexName(companyId);

  try {
    return await meili.getIndex(indexName);
  } catch {
    // Index doesn't exist, create it
    await meili.createIndex(indexName, { primaryKey: "id" });

    const index = meili.index<MessageDocument>(indexName);

    // Configure searchable attributes
    await index.updateSearchableAttributes([
      "content",
      "contactName",
      "contactJid",
    ]);

    // Configure filterable attributes
    await index.updateFilterableAttributes([
      "companyId",
      "contactId",
      "messageType",
      "timestamp",
      "isGroup",
      "fromMe",
    ]);

    // Configure sortable attributes
    await index.updateSortableAttributes(["timestamp"]);

    // Enable typo tolerance
    await index.updateTypoTolerance({
      enabled: true,
      minWordSizeForTypos: {
        oneTypo: 4,
        twoTypos: 8,
      },
    });

    return index;
  }
}

/**
 * Initialize or get contacts index for a company
 */
export async function getContactsIndex(
  companyId: string,
): Promise<Index<ContactDocument>> {
  const meili = getMeilisearchClient();
  const indexName = getContactsIndexName(companyId);

  try {
    return await meili.getIndex(indexName);
  } catch {
    // Index doesn't exist, create it
    await meili.createIndex(indexName, { primaryKey: "id" });

    const index = meili.index<ContactDocument>(indexName);

    // Configure searchable attributes
    await index.updateSearchableAttributes([
      "displayName",
      "customName",
      "pushName",
      "phoneNumber",
      "jid",
      "notesShared",
    ]);

    // Configure filterable attributes
    await index.updateFilterableAttributes(["companyId", "isGroup"]);

    // Configure sortable attributes
    await index.updateSortableAttributes(["displayName"]);

    // Enable typo tolerance
    await index.updateTypoTolerance({
      enabled: true,
      minWordSizeForTypos: {
        oneTypo: 3,
        twoTypos: 6,
      },
    });

    return index;
  }
}

/**
 * Index a message in Meilisearch
 */
export async function indexMessage(
  companyId: string,
  message: MessageDocument,
): Promise<void> {
  try {
    const index = await getMessagesIndex(companyId);
    await index.addDocuments([message]);
  } catch (error) {
    logger.error(formatError(error), "Failed to index message");
  }
}

/**
 * Index multiple messages in Meilisearch
 */
export async function indexMessages(
  companyId: string,
  messages: MessageDocument[],
): Promise<void> {
  if (messages.length === 0) return;

  try {
    const index = await getMessagesIndex(companyId);
    await index.addDocuments(messages);
  } catch (error) {
    logger.error(formatError(error), "Failed to index messages");
  }
}

/**
 * Index a contact in Meilisearch
 */
export async function indexContact(
  companyId: string,
  contact: ContactDocument,
): Promise<void> {
  try {
    const index = await getContactsIndex(companyId);
    await index.addDocuments([contact]);
  } catch (error) {
    logger.error(formatError(error), "Failed to index contact");
  }
}

/**
 * Index multiple contacts in Meilisearch
 */
export async function indexContacts(
  companyId: string,
  contacts: ContactDocument[],
): Promise<void> {
  if (contacts.length === 0) return;

  try {
    const index = await getContactsIndex(companyId);
    await index.addDocuments(contacts);
  } catch (error) {
    logger.error(formatError(error), "Failed to index contacts");
  }
}

/**
 * Delete a message from Meilisearch index
 */
export async function deleteMessage(
  companyId: string,
  messageId: string,
): Promise<void> {
  try {
    const index = await getMessagesIndex(companyId);
    await index.deleteDocument(messageId);
  } catch (error) {
    logger.error(formatError(error), "Failed to delete message");
  }
}

/**
 * Delete a contact from Meilisearch index
 */
export async function deleteContact(
  companyId: string,
  contactId: string,
): Promise<void> {
  try {
    const index = await getContactsIndex(companyId);
    await index.deleteDocument(contactId);
  } catch (error) {
    logger.error(formatError(error), "Failed to delete contact");
  }
}

/**
 * Search messages using Meilisearch
 */
export interface MeilisearchSearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  contactId?: string;
  startDate?: Date;
  endDate?: Date;
  messageTypes?: string[];
}

export interface MeilisearchMessageResult {
  id: string;
  contactId: string;
  contactName: string | null;
  contactJid: string | null;
  isGroup: boolean;
  messageId: string | null;
  content: string | null;
  messageType: string | null;
  timestamp: Date;
  highlights: string | null;
}

export async function searchMessagesWithMeilisearch(
  companyId: string,
  options: MeilisearchSearchOptions,
): Promise<{ results: MeilisearchMessageResult[]; total: number }> {
  const {
    query,
    limit = 50,
    offset = 0,
    contactId,
    startDate,
    endDate,
    messageTypes,
  } = options;

  try {
    const index = await getMessagesIndex(companyId);

    // Build filter array
    const filters: string[] = [`companyId = "${companyId}"`];

    if (contactId) {
      filters.push(`contactId = "${contactId}"`);
    }

    if (startDate) {
      filters.push(`timestamp >= ${Math.floor(startDate.getTime() / 1000)}`);
    }

    if (endDate) {
      filters.push(`timestamp <= ${Math.floor(endDate.getTime() / 1000)}`);
    }

    if (messageTypes && messageTypes.length > 0) {
      const typeFilter = messageTypes
        .map((t) => `messageType = "${t}"`)
        .join(" OR ");
      filters.push(`(${typeFilter})`);
    }

    const searchResult = await index.search(query, {
      limit,
      offset,
      filter: filters.join(" AND "),
      sort: ["timestamp:desc"],
      attributesToHighlight: ["content"],
      highlightPreTag: "<mark>",
      highlightPostTag: "</mark>",
    });

    const results: MeilisearchMessageResult[] = searchResult.hits.map(
      (hit) => ({
        id: hit.id,
        contactId: hit.contactId,
        contactName: hit.contactName,
        contactJid: hit.contactJid,
        isGroup: hit.isGroup,
        messageId: hit.messageId,
        content: hit.content,
        messageType: hit.messageType,
        timestamp: new Date(hit.timestamp * 1000),
        highlights:
          hit._formatted?.content !== hit.content
            ? hit._formatted?.content || null
            : null,
      }),
    );

    return {
      results,
      total: searchResult.estimatedTotalHits || results.length,
    };
  } catch (error) {
    logger.error(formatError(error), "Search failed");
    return { results: [], total: 0 };
  }
}

/**
 * Search contacts using Meilisearch
 */
export interface MeilisearchContactResult {
  id: string;
  jid: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  customName: string | null;
  displayName: string;
  isGroup: boolean;
  notesShared: string | null;
}

export async function searchContactsWithMeilisearch(
  companyId: string,
  query: string,
  options: { limit?: number; offset?: number; includeGroups?: boolean } = {},
): Promise<{ results: MeilisearchContactResult[]; total: number }> {
  const { limit = 50, offset = 0, includeGroups = true } = options;

  try {
    const index = await getContactsIndex(companyId);

    // Build filter
    const filters: string[] = [`companyId = "${companyId}"`];

    if (!includeGroups) {
      filters.push("isGroup = false");
    }

    const searchResult = await index.search(query, {
      limit,
      offset,
      filter: filters.join(" AND "),
      sort: ["displayName:asc"],
    });

    const results: MeilisearchContactResult[] = searchResult.hits.map(
      (hit) => ({
        id: hit.id,
        jid: hit.jid,
        phoneNumber: hit.phoneNumber,
        pushName: hit.pushName,
        customName: hit.customName,
        displayName: hit.displayName,
        isGroup: hit.isGroup,
        notesShared: hit.notesShared,
      }),
    );

    return {
      results,
      total: searchResult.estimatedTotalHits || results.length,
    };
  } catch (error) {
    logger.error(formatError(error), "Contact search failed");
    return { results: [], total: 0 };
  }
}

/**
 * Delete all documents for a company (when company is deleted)
 */
export async function deleteCompanyIndexes(companyId: string): Promise<void> {
  try {
    const meili = getMeilisearchClient();

    const messagesIndexName = getMessagesIndexName(companyId);
    const contactsIndexName = getContactsIndexName(companyId);

    await Promise.all([
      meili.deleteIndex(messagesIndexName).catch(() => {}),
      meili.deleteIndex(contactsIndexName).catch(() => {}),
    ]);
  } catch (error) {
    logger.error(formatError(error), "Failed to delete company indexes");
  }
}

/**
 * Get index statistics for a company
 */
export async function getIndexStats(
  companyId: string,
): Promise<{ messages: number; contacts: number } | null> {
  try {
    const meili = getMeilisearchClient();

    const messagesIndexName = getMessagesIndexName(companyId);
    const contactsIndexName = getContactsIndexName(companyId);

    const [messagesStats, contactsStats] = await Promise.all([
      meili
        .index(messagesIndexName)
        .getStats()
        .catch(() => null),
      meili
        .index(contactsIndexName)
        .getStats()
        .catch(() => null),
    ]);

    return {
      messages: messagesStats?.numberOfDocuments || 0,
      contacts: contactsStats?.numberOfDocuments || 0,
    };
  } catch {
    return null;
  }
}
