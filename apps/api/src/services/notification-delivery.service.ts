import { broadcastToUser } from "../lib/pusher.js";
import { createLogger, formatError } from "../lib/logger.js";
import {
  createNotifications,
  type CreateNotificationInput,
  type Notification,
} from "./notification-history.service.js";
import {
  sendPushToUsers as deliverPushToUsers,
  type PushDeliverySummary,
  type PushPayload,
} from "./web-push.service.js";

const logger = createLogger("NotificationDelivery");

interface DeliveryDependencies {
  persist: typeof createNotifications;
  publish: typeof broadcastToUser;
}

const defaultDependencies: DeliveryDependencies = {
  persist: createNotifications,
  publish: broadcastToUser,
};

export async function publishNotificationInvalidation(
  companyId: string,
  userId: string,
  notificationId: string,
  notificationType: string = "system",
  dependencies: DeliveryDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.publish(companyId, userId, "notification:new", {
    notificationId,
    userId,
    type: notificationType,
  });
}

export async function createAndPublishNotifications(
  companyId: string,
  inputs: CreateNotificationInput[],
  dependencies: DeliveryDependencies = defaultDependencies,
): Promise<Notification[]> {
  // This statement is the source of truth and completes before any signal.
  const notifications = await dependencies.persist(companyId, inputs);
  const outcomes = await Promise.allSettled(
    notifications.map((notification) =>
      publishNotificationInvalidation(
        companyId,
        notification.userId,
        notification.id,
        notification.notificationType,
        dependencies,
      ),
    ),
  );

  outcomes.forEach((outcome, index) => {
    const notification = notifications[index];
    if (outcome.status === "rejected") {
      logger.warn(
        {
          error: formatError(outcome.reason),
          companyId,
          userId: notification.userId,
          notificationId: notification.id,
          type: notification.notificationType,
          transport: "pusher",
          outcome: "failed",
        },
        "Notification persisted but realtime invalidation failed",
      );
    } else {
      logger.info(
        {
          companyId,
          userId: notification.userId,
          notificationId: notification.id,
          type: notification.notificationType,
          transport: "pusher",
          outcome: "published",
        },
        "Notification created",
      );
    }
  });
  return notifications;
}

export async function createAndPublishNotification(
  companyId: string,
  input: CreateNotificationInput,
  dependencies: DeliveryDependencies = defaultDependencies,
): Promise<Notification> {
  const [notification] = await createAndPublishNotifications(
    companyId,
    [input],
    dependencies,
  );
  if (!notification)
    throw new Error("Notification persistence returned no row");
  return notification;
}

export async function sendPushToUsers(
  companyId: string,
  userIds: string[],
  payload: PushPayload,
): Promise<PushDeliverySummary> {
  return deliverPushToUsers(companyId, userIds, payload);
}
