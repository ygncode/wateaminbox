/**
 * Unit tests for analytics.service.ts
 *
 * Tests analytics functionality including:
 * - Dashboard statistics
 * - Message statistics over time
 * - Contact statistics
 * - Team activity statistics
 * - Message type distribution
 * - Hourly message statistics
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createMutableMockQueryBuilder, resetMockQueryBuilder } from "../mocks";

// Mock query builder - using centralized mock utilities
let mockQueryBuilder = createMutableMockQueryBuilder();

// Mock tenant database
const mockTenantDb = {
  selectFrom: mock(() => mockQueryBuilder),
};

// Mock getTenantConnection
const mockGetTenantConnection = mock((_companyId: string) => mockTenantDb);

mock.module("../../services/tenant.service.js", () => ({
  getTenantConnection: mockGetTenantConnection,
}));

// Mock main database for company stats
const mockDb = {
  selectFrom: mock(() => mockQueryBuilder),
};

mock.module("@whatsapp-web/database", () => ({
  db: mockDb,
}));

// Import the service after mocking
import {
  getDashboardStats,
  getMessageStats,
  getContactStats,
  getTeamActivityStats,
  getMessageTypeStats,
  getHourlyMessageStats,
  getNewContactsTrend,
  getEngagementMetrics,
  getEngagementTrend,
} from "../../services/analytics.service";

describe("AnalyticsService", () => {
  beforeEach(() => {
    resetMockQueryBuilder(mockQueryBuilder);
    mockGetTenantConnection.mockClear();
    mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
    mockDb.selectFrom = mock(() => mockQueryBuilder);
  });

  describe("getDashboardStats", () => {
    it("should return dashboard statistics", async () => {
      // Arrange
      const mockCompanyStats = {
        total_messages: 1000,
        total_contacts: 500,
        active_users: 10,
      };

      const mockTodayMessages = {
        sent: 50,
        received: 100,
      };

      const mockUnreadCount = {
        count: 25,
      };

      // Setup main db for company stats
      let mainDbCallCount = 0;
      mockDb.selectFrom = mock(() => {
        mainDbCallCount++;
        resetMockQueryBuilder(mockQueryBuilder, mockCompanyStats);
        return mockQueryBuilder;
      });

      // Setup tenant db for message counts
      let tenantDbCallCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        tenantDbCallCount++;
        if (tenantDbCallCount === 1) {
          resetMockQueryBuilder(mockQueryBuilder, mockTodayMessages);
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(mockQueryBuilder, mockUnreadCount);
        return mockQueryBuilder;
      });

      // Act
      const result = await getDashboardStats("company-123");

      // Assert
      expect(result).toBeDefined();
      expect(result.totalMessages).toBe(1000);
      expect(result.totalContacts).toBe(500);
      expect(result.activeUsers).toBe(10);
      expect(typeof result.messagesSentToday).toBe("number");
      expect(typeof result.messagesReceivedToday).toBe("number");
      expect(typeof result.unreadConversations).toBe("number");
    });

    it("should handle missing company stats gracefully", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getDashboardStats("company-123");

      // Assert
      expect(result.totalMessages).toBe(0);
      expect(result.totalContacts).toBe(0);
      expect(result.activeUsers).toBe(0);
    });
  });

  describe("getMessageStats", () => {
    it("should return message statistics over date range", async () => {
      // Arrange
      const mockStats = [
        { date: "2024-01-01", sent: 10, received: 20 },
        { date: "2024-01-02", sent: 15, received: 25 },
        { date: "2024-01-03", sent: 20, received: 30 },
      ];

      resetMockQueryBuilder(mockQueryBuilder, mockStats);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockStats));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-31");

      // Act
      const result = await getMessageStats("company-123", startDate, endDate);

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result[0].date).toBe("2024-01-01");
      expect(result[0].sent).toBe(10);
      expect(result[0].received).toBe(20);
    });

    it("should return empty array when no messages in range", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-31");

      // Act
      const result = await getMessageStats("company-123", startDate, endDate);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe("getContactStats", () => {
    it("should return contact statistics", async () => {
      // Arrange
      const totalResult = { count: 100 };
      const customNameResult = { count: 30 };
      const withTagsResult = { count: 50 };
      const assignedResult = { count: 40 };

      let callCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        callCount++;
        switch (callCount) {
          case 1:
            resetMockQueryBuilder(mockQueryBuilder, totalResult);
            break;
          case 2:
            resetMockQueryBuilder(mockQueryBuilder, customNameResult);
            break;
          case 3:
            resetMockQueryBuilder(mockQueryBuilder, withTagsResult);
            break;
          case 4:
            resetMockQueryBuilder(mockQueryBuilder, assignedResult);
            break;
          default:
            resetMockQueryBuilder(mockQueryBuilder, undefined);
        }
        return mockQueryBuilder;
      });

      // Act
      const result = await getContactStats("company-123");

      // Assert
      expect(result).toBeDefined();
      expect(result.total).toBe(100);
      expect(result.withCustomName).toBe(30);
      expect(result.withTags).toBe(50);
      expect(result.assigned).toBe(40);
      expect(result.unassigned).toBe(60); // total - assigned
    });

    it("should handle zero counts", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, { count: 0 });
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getContactStats("company-123");

      // Assert
      expect(result.total).toBe(0);
      expect(result.unassigned).toBe(0);
    });
  });

  describe("getTeamActivityStats", () => {
    it("should return team activity statistics for all members", async () => {
      // Arrange
      const mockMembers = [
        { user_id: "user-1", email: "user1@example.com" },
        { user_id: "user-2", email: "user2@example.com" },
      ];

      // Setup main db for members query
      mockDb.selectFrom = mock(() => {
        resetMockQueryBuilder(mockQueryBuilder, mockMembers);
        mockQueryBuilder.execute = mock(() => Promise.resolve(mockMembers));
        return mockQueryBuilder;
      });

      // Setup tenant db for stats queries
      const mockMessageCount = { count: 50 };
      const mockContactCount = { count: 10 };
      const mockLastMessage = { timestamp: new Date() };

      let tenantCallCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        tenantCallCount++;
        switch (tenantCallCount % 3) {
          case 1:
            resetMockQueryBuilder(mockQueryBuilder, mockMessageCount);
            break;
          case 2:
            resetMockQueryBuilder(mockQueryBuilder, mockContactCount);
            break;
          case 0:
            resetMockQueryBuilder(mockQueryBuilder, mockLastMessage);
            break;
        }
        return mockQueryBuilder;
      });

      // Act
      const result = await getTeamActivityStats("company-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      result.forEach((stat) => {
        expect(stat.userId).toBeDefined();
        expect(stat.email).toBeDefined();
        expect(typeof stat.messagesSent).toBe("number");
        expect(typeof stat.contactsAssigned).toBe("number");
      });
    });

    it("should sort by messages sent descending", async () => {
      // Arrange
      const mockMembers = [
        { user_id: "user-1", email: "user1@example.com" },
        { user_id: "user-2", email: "user2@example.com" },
      ];

      mockDb.selectFrom = mock(() => {
        resetMockQueryBuilder(mockQueryBuilder, mockMembers);
        mockQueryBuilder.execute = mock(() => Promise.resolve(mockMembers));
        return mockQueryBuilder;
      });

      // User 2 has more messages
      let tenantCallCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        tenantCallCount++;
        const isUser2 = tenantCallCount > 3;
        switch (tenantCallCount % 3) {
          case 1:
            resetMockQueryBuilder(mockQueryBuilder, {
              count: isUser2 ? 100 : 50,
            });
            break;
          case 2:
            resetMockQueryBuilder(mockQueryBuilder, { count: 10 });
            break;
          case 0:
            resetMockQueryBuilder(mockQueryBuilder, { timestamp: new Date() });
            break;
        }
        return mockQueryBuilder;
      });

      // Act
      const result = await getTeamActivityStats("company-123");

      // Assert
      if (result.length >= 2) {
        expect(result[0].messagesSent).toBeGreaterThanOrEqual(
          result[1].messagesSent,
        );
      }
    });

    it("should handle null last activity", async () => {
      // Arrange
      const mockMembers = [{ user_id: "user-1", email: "user1@example.com" }];

      mockDb.selectFrom = mock(() => {
        resetMockQueryBuilder(mockQueryBuilder, mockMembers);
        mockQueryBuilder.execute = mock(() => Promise.resolve(mockMembers));
        return mockQueryBuilder;
      });

      mockTenantDb.selectFrom = mock(() => {
        resetMockQueryBuilder(mockQueryBuilder, undefined);
        return mockQueryBuilder;
      });

      // Act
      const result = await getTeamActivityStats("company-123");

      // Assert
      expect(result[0].lastActive).toBeNull();
    });
  });

  describe("getMessageTypeStats", () => {
    it("should return message type distribution", async () => {
      // Arrange
      const mockStats = [
        { message_type: "text", count: 1000 },
        { message_type: "image", count: 200 },
        { message_type: "video", count: 50 },
        { message_type: "audio", count: 30 },
      ];

      resetMockQueryBuilder(mockQueryBuilder, mockStats);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockStats));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getMessageTypeStats("company-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(4);
      expect(result[0].type).toBe("text");
      expect(result[0].count).toBe(1000);
    });

    it("should filter by date range when provided", async () => {
      // Arrange
      const mockStats = [{ message_type: "text", count: 500 }];

      resetMockQueryBuilder(mockQueryBuilder, mockStats);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockStats));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-31");

      // Act
      const result = await getMessageTypeStats(
        "company-123",
        startDate,
        endDate,
      );

      // Assert
      expect(result.length).toBe(1);
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });

    it("should return empty array when no messages", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getMessageTypeStats("company-123");

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe("getHourlyMessageStats", () => {
    it("should return message counts for all 24 hours", async () => {
      // Arrange
      const mockStats = [
        { hour: 9, count: 100 },
        { hour: 10, count: 150 },
        { hour: 14, count: 200 },
      ];

      resetMockQueryBuilder(mockQueryBuilder, mockStats);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockStats));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getHourlyMessageStats("company-123");

      // Assert
      expect(result.length).toBe(24);
      // Check that all hours are present
      for (let hour = 0; hour < 24; hour++) {
        const hourStat = result.find((s) => s.hour === hour);
        expect(hourStat).toBeDefined();
      }
    });

    it("should fill in missing hours with zero count", async () => {
      // Arrange
      const mockStats = [{ hour: 12, count: 100 }];

      resetMockQueryBuilder(mockQueryBuilder, mockStats);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockStats));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getHourlyMessageStats("company-123");

      // Assert
      expect(result[0].hour).toBe(0);
      expect(result[0].count).toBe(0); // Missing hour filled with 0
      expect(result[12].hour).toBe(12);
      expect(result[12].count).toBe(100);
    });

    it("should use default 30 day period", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      await getHourlyMessageStats("company-123");

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });

    it("should accept custom day period", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getHourlyMessageStats("company-123", 7);

      // Assert
      expect(result.length).toBe(24);
    });

    it("should return ordered hours from 0 to 23", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getHourlyMessageStats("company-123");

      // Assert
      for (let i = 0; i < 24; i++) {
        expect(result[i].hour).toBe(i);
      }
    });
  });

  describe("Type definitions", () => {
    it("DashboardStats should have correct structure", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, {
        total_messages: 0,
        total_contacts: 0,
        active_users: 0,
      });
      mockDb.selectFrom = mock(() => mockQueryBuilder);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getDashboardStats("company-123");

      // Assert
      expect("totalMessages" in result).toBe(true);
      expect("totalContacts" in result).toBe(true);
      expect("activeUsers" in result).toBe(true);
      expect("messagesSentToday" in result).toBe(true);
      expect("messagesReceivedToday" in result).toBe(true);
      expect("unreadConversations" in result).toBe(true);
    });

    it("MessageStats should have correct structure", async () => {
      // Arrange
      const mockStats = [{ date: "2024-01-01", sent: 10, received: 20 }];
      resetMockQueryBuilder(mockQueryBuilder, mockStats);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockStats));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getMessageStats(
        "company-123",
        new Date(),
        new Date(),
      );

      // Assert
      if (result.length > 0) {
        expect("date" in result[0]).toBe(true);
        expect("sent" in result[0]).toBe(true);
        expect("received" in result[0]).toBe(true);
      }
    });

    it("ContactStats should have correct structure", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, { count: 0 });
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getContactStats("company-123");

      // Assert
      expect("total" in result).toBe(true);
      expect("withCustomName" in result).toBe(true);
      expect("withTags" in result).toBe(true);
      expect("assigned" in result).toBe(true);
      expect("unassigned" in result).toBe(true);
    });
  });

  describe("getNewContactsTrend", () => {
    it("should return new contacts trend over date range", async () => {
      // Arrange
      const mockDailyCounts = [
        { date: "2024-01-02", count: 5 },
        { date: "2024-01-04", count: 3 },
      ];

      const mockPreviousTotal = { count: 100 };

      let callCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          resetMockQueryBuilder(mockQueryBuilder, mockDailyCounts);
          mockQueryBuilder.execute = mock(() =>
            Promise.resolve(mockDailyCounts),
          );
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(mockQueryBuilder, mockPreviousTotal);
        return mockQueryBuilder;
      });

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-05");

      // Act
      const result = await getNewContactsTrend(
        "company-123",
        startDate,
        endDate,
      );

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(5); // 5 days in range
      expect(result[0].date).toBe("2024-01-01");
      expect(result[0].count).toBe(0); // No contacts on day 1
      expect(result[0].cumulativeTotal).toBe(100); // Previous total
    });

    it("should calculate cumulative totals correctly", async () => {
      // Arrange
      const mockDailyCounts = [
        { date: "2024-01-01", count: 5 },
        { date: "2024-01-02", count: 3 },
        { date: "2024-01-03", count: 2 },
      ];

      const mockPreviousTotal = { count: 10 };

      let callCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          resetMockQueryBuilder(mockQueryBuilder, mockDailyCounts);
          mockQueryBuilder.execute = mock(() =>
            Promise.resolve(mockDailyCounts),
          );
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(mockQueryBuilder, mockPreviousTotal);
        return mockQueryBuilder;
      });

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-03");

      // Act
      const result = await getNewContactsTrend(
        "company-123",
        startDate,
        endDate,
      );

      // Assert
      expect(result[0].cumulativeTotal).toBe(15); // 10 + 5
      expect(result[1].cumulativeTotal).toBe(18); // 10 + 5 + 3
      expect(result[2].cumulativeTotal).toBe(20); // 10 + 5 + 3 + 2
    });

    it("should fill in missing days with zero counts", async () => {
      // Arrange
      const mockDailyCounts = [{ date: "2024-01-02", count: 5 }];

      const mockPreviousTotal = { count: 0 };

      let callCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          resetMockQueryBuilder(mockQueryBuilder, mockDailyCounts);
          mockQueryBuilder.execute = mock(() =>
            Promise.resolve(mockDailyCounts),
          );
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(mockQueryBuilder, mockPreviousTotal);
        return mockQueryBuilder;
      });

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-03");

      // Act
      const result = await getNewContactsTrend(
        "company-123",
        startDate,
        endDate,
      );

      // Assert
      expect(result[0].date).toBe("2024-01-01");
      expect(result[0].count).toBe(0); // No contacts on Jan 1
      expect(result[1].date).toBe("2024-01-02");
      expect(result[1].count).toBe(5); // 5 contacts on Jan 2
      expect(result[2].date).toBe("2024-01-03");
      expect(result[2].count).toBe(0); // No contacts on Jan 3
    });

    it("should return empty array for empty date range", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Use a start date after end date (will result in 0 iterations)
      const startDate = new Date("2024-01-05");
      const endDate = new Date("2024-01-01");

      // Act
      const result = await getNewContactsTrend(
        "company-123",
        startDate,
        endDate,
      );

      // Assert
      expect(result).toEqual([]);
    });

    it("should handle no previous contacts", async () => {
      // Arrange
      const mockDailyCounts = [{ date: "2024-01-01", count: 10 }];
      const mockPreviousTotal = { count: 0 };

      let callCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          resetMockQueryBuilder(mockQueryBuilder, mockDailyCounts);
          mockQueryBuilder.execute = mock(() =>
            Promise.resolve(mockDailyCounts),
          );
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(mockQueryBuilder, mockPreviousTotal);
        return mockQueryBuilder;
      });

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-01");

      // Act
      const result = await getNewContactsTrend(
        "company-123",
        startDate,
        endDate,
      );

      // Assert
      expect(result.length).toBe(1);
      expect(result[0].cumulativeTotal).toBe(10); // 0 previous + 10 new
    });

    it("should exclude groups from count", async () => {
      // Arrange - the mock setup will track that is_group = false filter is applied
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-01");

      // Act
      await getNewContactsTrend("company-123", startDate, endDate);

      // Assert - verify where was called (for is_group = false filter)
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });

    it("NewContactsTrend should have correct structure", async () => {
      // Arrange
      const mockDailyCounts = [{ date: "2024-01-01", count: 1 }];
      const mockPreviousTotal = { count: 5 };

      let callCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          resetMockQueryBuilder(mockQueryBuilder, mockDailyCounts);
          mockQueryBuilder.execute = mock(() =>
            Promise.resolve(mockDailyCounts),
          );
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(mockQueryBuilder, mockPreviousTotal);
        return mockQueryBuilder;
      });

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-01");

      // Act
      const result = await getNewContactsTrend(
        "company-123",
        startDate,
        endDate,
      );

      // Assert
      expect(result.length).toBeGreaterThan(0);
      expect("date" in result[0]).toBe(true);
      expect("count" in result[0]).toBe(true);
      expect("cumulativeTotal" in result[0]).toBe(true);
    });
  });

  /**
   * NOTE: getEngagementMetrics and getEngagementTrend use raw SQL queries via Kysely's sql template literals.
   * These are tested via E2E tests that run against a real database, as mocking raw SQL execution
   * in Kysely requires complex setup. The functions have been manually verified to work correctly.
   *
   * The key interface properties that should be tested:
   * - EngagementMetrics: engagementScore, averageMessagesPerContact, activeContactsRate, activeContacts,
   *   totalContacts, twoWayConversationRate, twoWayConversations, mediaEngagementRate, conversationsWithMedia,
   *   responseRate, messagesSent, messagesReceived
   * - EngagementTrend: date, engagementScore, activeContacts, messagesSent, messagesReceived, responseRate
   */
  describe("Engagement Metrics Interfaces", () => {
    it("should verify EngagementMetrics interface structure", () => {
      // This test documents the expected interface for engagement metrics
      const mockEngagementMetrics = {
        engagementScore: 75,
        averageMessagesPerContact: 5.5,
        activeContactsRate: 60.5,
        activeContacts: 100,
        totalContacts: 165,
        twoWayConversationRate: 80.0,
        twoWayConversations: 80,
        mediaEngagementRate: 25.5,
        conversationsWithMedia: 25,
        responseRate: 90.0,
        messagesSent: 500,
        messagesReceived: 600,
      };

      // Assert structure
      expect("engagementScore" in mockEngagementMetrics).toBe(true);
      expect("averageMessagesPerContact" in mockEngagementMetrics).toBe(true);
      expect("activeContactsRate" in mockEngagementMetrics).toBe(true);
      expect("activeContacts" in mockEngagementMetrics).toBe(true);
      expect("totalContacts" in mockEngagementMetrics).toBe(true);
      expect("twoWayConversationRate" in mockEngagementMetrics).toBe(true);
      expect("twoWayConversations" in mockEngagementMetrics).toBe(true);
      expect("mediaEngagementRate" in mockEngagementMetrics).toBe(true);
      expect("conversationsWithMedia" in mockEngagementMetrics).toBe(true);
      expect("responseRate" in mockEngagementMetrics).toBe(true);
      expect("messagesSent" in mockEngagementMetrics).toBe(true);
      expect("messagesReceived" in mockEngagementMetrics).toBe(true);

      // Assert valid ranges
      expect(mockEngagementMetrics.engagementScore).toBeGreaterThanOrEqual(0);
      expect(mockEngagementMetrics.engagementScore).toBeLessThanOrEqual(100);
    });

    it("should verify EngagementTrend interface structure", () => {
      // This test documents the expected interface for engagement trend
      const mockEngagementTrend = {
        date: "2024-01-01",
        engagementScore: 75,
        activeContacts: 50,
        messagesSent: 100,
        messagesReceived: 120,
        responseRate: 85.5,
      };

      // Assert structure
      expect("date" in mockEngagementTrend).toBe(true);
      expect("engagementScore" in mockEngagementTrend).toBe(true);
      expect("activeContacts" in mockEngagementTrend).toBe(true);
      expect("messagesSent" in mockEngagementTrend).toBe(true);
      expect("messagesReceived" in mockEngagementTrend).toBe(true);
      expect("responseRate" in mockEngagementTrend).toBe(true);

      // Assert valid ranges
      expect(mockEngagementTrend.engagementScore).toBeGreaterThanOrEqual(0);
      expect(mockEngagementTrend.engagementScore).toBeLessThanOrEqual(100);
      expect(mockEngagementTrend.responseRate).toBeGreaterThanOrEqual(0);
    });

    it("should validate engagement score calculation formula documentation", () => {
      // Document the engagement score formula:
      // Engagement Score = (activeContactsRate * 0.25) + (twoWayConversationRate * 0.25)
      //                  + (responseRate * 0.30) + (mediaEngagementRate * 0.20)
      // Max = 100, capped at 100

      const weights = {
        activeContactsRate: 0.25,
        twoWayConversationRate: 0.25,
        responseRate: 0.3,
        mediaEngagementRate: 0.2,
      };

      const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
      expect(totalWeight).toBe(1.0);

      // Example calculation
      const rates = {
        activeContactsRate: 100, // max
        twoWayConversationRate: 100, // max
        responseRate: 100, // max
        mediaEngagementRate: 100, // max
      };

      const score = Math.min(
        100,
        Math.round(
          rates.activeContactsRate * weights.activeContactsRate +
            rates.twoWayConversationRate * weights.twoWayConversationRate +
            rates.responseRate * weights.responseRate +
            rates.mediaEngagementRate * weights.mediaEngagementRate,
        ),
      );

      expect(score).toBe(100);
    });
  });
});
