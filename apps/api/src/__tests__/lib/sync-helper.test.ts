import { describe, expect, it, mock } from "bun:test";
import { syncEntities, type SyncConfig } from "../../lib/sync-helper.js";

// Test types
interface IncomingItem {
  id: string;
  name: string;
  value: number;
}

interface ExistingItem {
  id: string;
  name: string;
  value: number;
}

describe("syncEntities", () => {
  it("should add new items when nothing exists", async () => {
    const insert = mock(async () => {});
    const update = mock(async () => {});
    const remove = mock(async () => {});

    const config: SyncConfig<IncomingItem, ExistingItem, string> = {
      getId: (item) => item.id,
      getExistingId: (item) => item.id,
      insert,
      update,
      remove,
    };

    const incoming = [
      { id: "1", name: "Item 1", value: 100 },
      { id: "2", name: "Item 2", value: 200 },
    ];

    const result = await syncEntities(config, [], incoming);

    expect(result).toEqual({
      added: 2,
      updated: 0,
      removed: 0,
      total: 2,
    });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("should update existing items when they match", async () => {
    const insert = mock(async () => {});
    const update = mock(async () => {});
    const remove = mock(async () => {});

    const config: SyncConfig<IncomingItem, ExistingItem, string> = {
      getId: (item) => item.id,
      getExistingId: (item) => item.id,
      insert,
      update,
      remove,
    };

    const existing = [
      { id: "1", name: "Old Item 1", value: 100 },
      { id: "2", name: "Old Item 2", value: 200 },
    ];

    const incoming = [
      { id: "1", name: "New Item 1", value: 150 },
      { id: "2", name: "New Item 2", value: 250 },
    ];

    const result = await syncEntities(config, existing, incoming);

    expect(result).toEqual({
      added: 0,
      updated: 2,
      removed: 0,
      total: 2,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
  });

  it("should remove items that no longer exist in incoming", async () => {
    const insert = mock(async () => {});
    const update = mock(async () => {});
    const remove = mock(async () => {});

    const config: SyncConfig<IncomingItem, ExistingItem, string> = {
      getId: (item) => item.id,
      getExistingId: (item) => item.id,
      insert,
      update,
      remove,
    };

    const existing = [
      { id: "1", name: "Item 1", value: 100 },
      { id: "2", name: "Item 2", value: 200 },
      { id: "3", name: "Item 3", value: 300 },
    ];

    const incoming: IncomingItem[] = [];

    const result = await syncEntities(config, existing, incoming);

    expect(result).toEqual({
      added: 0,
      updated: 0,
      removed: 3,
      total: 0,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it("should handle mixed scenario: add, update, and remove", async () => {
    const insert = mock(async () => {});
    const update = mock(async () => {});
    const remove = mock(async () => {});

    const config: SyncConfig<IncomingItem, ExistingItem, string> = {
      getId: (item) => item.id,
      getExistingId: (item) => item.id,
      insert,
      update,
      remove,
    };

    const existing = [
      { id: "1", name: "Item 1", value: 100 },
      { id: "2", name: "Item 2", value: 200 },
      { id: "3", name: "Item 3", value: 300 },
    ];

    const incoming = [
      { id: "1", name: "Updated Item 1", value: 150 }, // Update
      { id: "4", name: "New Item 4", value: 400 }, // Add
      { id: "5", name: "New Item 5", value: 500 }, // Add
      // Items 2 and 3 will be removed
    ];

    const result = await syncEntities(config, existing, incoming);

    expect(result).toEqual({
      added: 2, // Items 4 and 5
      updated: 1, // Item 1
      removed: 2, // Items 2 and 3
      total: 3,
    });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("should skip update when isUnchanged returns true", async () => {
    const insert = mock(async () => {});
    const update = mock(async () => {});
    const remove = mock(async () => {});

    const config: SyncConfig<IncomingItem, ExistingItem, string> = {
      getId: (item) => item.id,
      getExistingId: (item) => item.id,
      insert,
      update,
      remove,
      isUnchanged: (incoming, existing) =>
        incoming.name === existing.name && incoming.value === existing.value,
    };

    const existing = [
      { id: "1", name: "Item 1", value: 100 },
      { id: "2", name: "Item 2", value: 200 },
    ];

    const incoming = [
      { id: "1", name: "Item 1", value: 100 }, // Unchanged
      { id: "2", name: "Item 2 Updated", value: 250 }, // Changed
    ];

    const result = await syncEntities(config, existing, incoming);

    expect(result).toEqual({
      added: 0,
      updated: 1, // Only item 2
      removed: 0,
      total: 2,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(incoming[1], existing[1]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("should pass correct arguments to callbacks", async () => {
    const insert = mock(async () => {});
    const update = mock(async () => {});
    const remove = mock(async () => {});

    const config: SyncConfig<IncomingItem, ExistingItem, string> = {
      getId: (item) => item.id,
      getExistingId: (item) => item.id,
      insert,
      update,
      remove,
    };

    const existing = [{ id: "1", name: "Old", value: 100 }];
    const incoming = [
      { id: "1", name: "New", value: 150 },
      { id: "2", name: "Added", value: 200 },
    ];

    await syncEntities(config, existing, incoming);

    // Check insert was called with new item
    expect(insert).toHaveBeenCalledWith({ id: "2", name: "Added", value: 200 });

    // Check update was called with both incoming and existing
    expect(update).toHaveBeenCalledWith(
      { id: "1", name: "New", value: 150 },
      { id: "1", name: "Old", value: 100 },
    );
  });

  it("should handle empty incoming and existing arrays", async () => {
    const insert = mock(async () => {});
    const update = mock(async () => {});
    const remove = mock(async () => {});

    const config: SyncConfig<IncomingItem, ExistingItem, string> = {
      getId: (item) => item.id,
      getExistingId: (item) => item.id,
      insert,
      update,
      remove,
    };

    const result = await syncEntities(config, [], []);

    expect(result).toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      total: 0,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("should handle different ID types (number)", async () => {
    interface NumericItem {
      id: number;
      name: string;
    }

    const insert = mock(async () => {});
    const update = mock(async () => {});
    const remove = mock(async () => {});

    const config: SyncConfig<NumericItem, NumericItem, number> = {
      getId: (item) => item.id,
      getExistingId: (item) => item.id,
      insert,
      update,
      remove,
    };

    const existing = [
      { id: 1, name: "One" },
      { id: 2, name: "Two" },
    ];

    const incoming = [
      { id: 1, name: "One Updated" },
      { id: 3, name: "Three" },
    ];

    const result = await syncEntities(config, existing, incoming);

    expect(result).toEqual({
      added: 1, // Item 3
      updated: 1, // Item 1
      removed: 1, // Item 2
      total: 2,
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
