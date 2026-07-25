import type {
  CatalogProductsEvent,
  CatalogsEvent,
  LabelsEvent,
  CommandResultEvent,
} from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import {
  syncCatalogProductsFromWhatsApp,
  syncCatalogsFromWhatsApp,
  type CatalogStatus,
  type ProductVisibility,
} from "../catalog-sync.service.js";
import { syncLabelsFromWhatsApp } from "../label-sync.service.js";
import { getTenantConnection } from "../tenant.service.js";

export async function handleLabelsEvent(event: LabelsEvent): Promise<void> {
  const tenantDb = getTenantConnection(event.companyId);
  const result = await tenantDb
    .transaction()
    .execute((trx) => syncLabelsFromWhatsApp(trx, event.payload.labels));
  await broadcastToCompany(event.companyId, "labels:updated", { result });
}

export async function handleCatalogsEvent(event: CatalogsEvent): Promise<void> {
  const tenantDb = getTenantConnection(event.companyId);
  const catalogs = event.payload.catalogs.map((catalog) => ({
    ...catalog,
    status: catalog.status as CatalogStatus | undefined,
  }));
  const result = await tenantDb
    .transaction()
    .execute((trx) => syncCatalogsFromWhatsApp(trx, catalogs));
  await broadcastToCompany(event.companyId, "catalogs:updated", { result });
}

export async function handleCommandResultEvent(
  event: CommandResultEvent,
): Promise<void> {
  if (event.payload.success) return;
  await broadcastToCompany(
    event.companyId,
    "command:failed",
    event.payload,
    event.connectionId,
  );
  await broadcastToCompany(
    event.companyId,
    "notification:toast",
    {
      type: "error",
      title: "WhatsApp action failed",
      message: event.payload.error || `${event.payload.commandType} failed`,
    },
    event.connectionId,
  );
}

export async function handleCatalogProductsEvent(
  event: CatalogProductsEvent,
): Promise<void> {
  const tenantDb = getTenantConnection(event.companyId);
  const products = event.payload.products.map((product) => ({
    ...product,
    catalogId: event.payload.catalogId,
    visibility: product.visibility as ProductVisibility | undefined,
  }));
  await tenantDb
    .transaction()
    .execute((trx) =>
      syncCatalogProductsFromWhatsApp(trx, event.payload.catalogId, products),
    );
  await broadcastToCompany(event.companyId, "catalogs:updated", {
    catalogId: event.payload.catalogId,
  });
}
