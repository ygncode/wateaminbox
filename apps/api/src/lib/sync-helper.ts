import type { Kysely } from "kysely";

/**
 * Configuration for sync operation
 */
export interface SyncConfig<TIncoming, TExisting, TId> {
  /**
   * Extract the unique identifier from incoming item
   */
  getId: (item: TIncoming) => TId;

  /**
   * Extract the unique identifier from existing item
   */
  getExistingId: (item: TExisting) => TId;

  /**
   * Insert a new item
   */
  insert: (item: TIncoming) => Promise<void>;

  /**
   * Update an existing item
   */
  update: (incoming: TIncoming, existing: TExisting) => Promise<void>;

  /**
   * Remove an item that no longer exists in the source
   */
  remove: (existing: TExisting) => Promise<void>;

  /**
   * Optional predicate to check if an item should be skipped during update
   * Returns true if the item is unchanged and should not be updated
   */
  isUnchanged?: (incoming: TIncoming, existing: TExisting) => boolean;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/**
 * Generic entity synchronization helper
 *
 * Implements the common sync algorithm:
 * 1. Get existing items into a Map by ID
 * 2. Create Set of incoming IDs
 * 3. For each incoming item:
 *    - If exists: update (unless unchanged)
 *    - Else: insert
 * 4. Remove items not in incoming set
 * 5. Return sync statistics
 *
 * @example
 * ```typescript
 * const result = await syncEntities({
 *   getId: (catalog) => catalog.catalogId,
 *   getExistingId: (catalog) => catalog.catalog_id,
 *   insert: async (catalog) => {
 *     await db.insertInto('catalogs').values(...).execute()
 *   },
 *   update: async (incoming, existing) => {
 *     await db.updateTable('catalogs').set(...).execute()
 *   },
 *   remove: async (existing) => {
 *     await db.deleteFrom('catalogs').where(...).execute()
 *   },
 *   isUnchanged: (incoming, existing) => {
 *     return incoming.name === existing.name
 *   }
 * }, existingItems, incomingItems)
 * ```
 */
export async function syncEntities<TIncoming, TExisting, TId>(
  config: SyncConfig<TIncoming, TExisting, TId>,
  existingItems: TExisting[],
  incomingItems: TIncoming[],
): Promise<SyncResult> {
  let added = 0;
  let updated = 0;
  let removed = 0;

  // Build map of existing items by ID
  const existingMap = new Map<TId, TExisting>();
  for (const item of existingItems) {
    existingMap.set(config.getExistingId(item), item);
  }

  // Build set of incoming IDs
  const incomingIds = new Set<TId>();
  for (const item of incomingItems) {
    incomingIds.add(config.getId(item));
  }

  // Process incoming items (add or update)
  for (const incoming of incomingItems) {
    const id = config.getId(incoming);
    const existing = existingMap.get(id);

    if (existing) {
      // Check if update should be skipped
      if (config.isUnchanged && config.isUnchanged(incoming, existing)) {
        continue;
      }

      // Update existing item
      await config.update(incoming, existing);
      updated++;
    } else {
      // Insert new item
      await config.insert(incoming);
      added++;
    }
  }

  // Remove items that no longer exist in incoming set
  const toRemove = existingItems.filter(
    (item) => !incomingIds.has(config.getExistingId(item)),
  );

  for (const item of toRemove) {
    await config.remove(item);
    removed++;
  }

  return {
    added,
    updated,
    removed,
    total: incomingItems.length,
  };
}
