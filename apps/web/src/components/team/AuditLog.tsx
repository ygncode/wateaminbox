import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { dayjs } from "@wateaminbox/shared";
import {
  Activity,
  ChevronRight,
  FileDown,
  Filter,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServerDataTable } from "@/components/ui/server-data-table";
import {
  type AuditAction,
  type AuditLog as AuditLogType,
  formatAuditAction,
  useAuditActions,
  useAuditActors,
  useAuditLogs,
} from "@/hooks/useAudit";
import { fetchBlobWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface AuditLogProps {
  companyId: string;
  canExport?: boolean;
}

const entityTypes = [
  "company",
  "member",
  "invitation",
  "contact",
  "conversation",
  "message",
  "tag",
];

export function AuditLog({ companyId, canExport = false }: AuditLogProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(0, Math.floor(Number(searchParams.get("page")) || 0));
  const actionFilter = (searchParams.get("action") || "") as AuditAction | "";
  const actorFilter = searchParams.get("actor") || "";
  const entityFilter = searchParams.get("entity") || "";
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";
  const hasFilters = Boolean(
    actionFilter || actorFilter || entityFilter || startDate || endDate,
  );
  const activeFilterCount = [
    actionFilter,
    actorFilter,
    entityFilter,
    startDate,
    endDate,
  ].filter(Boolean).length;
  const [showFilters, setShowFilters] = useState(hasFilters);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const requestedPageSize = Number(searchParams.get("pageSize"));
  const pageSize = [10, 20, 50].includes(requestedPageSize)
    ? requestedPageSize
    : 20;
  const pagination: PaginationState = { pageIndex: page, pageSize };

  const { data, isLoading, isFetching, error } = useAuditLogs(companyId, {
    userId: actorFilter || undefined,
    action: actionFilter || undefined,
    entityType: entityFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    limit: pageSize,
    offset: page * pageSize,
  });
  const { data: actions } = useAuditActions();
  const { data: actors } = useAuditActors();

  const setFilter = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      return next;
    });
  };
  const setPagination = (nextPagination: PaginationState) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPagination.pageIndex > 0) {
        next.set("page", String(nextPagination.pageIndex));
      } else {
        next.delete("page");
      }
      if (nextPagination.pageSize !== 20) {
        next.set("pageSize", String(nextPagination.pageSize));
      } else {
        next.delete("pageSize");
      }
      if (nextPagination.pageSize !== pageSize) {
        next.delete("page");
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearchParams(() => {
      const next = new URLSearchParams();
      if (pageSize !== 20) next.set("pageSize", String(pageSize));
      return next;
    });
  };

  const columns: ColumnDef<AuditLogType>[] = [
    {
      accessorKey: "createdAt",
      header: "Time",
      size: 155,
      cell: ({ row }) => {
        const occurredAt = dayjs(row.original.createdAt);
        return (
          <time
            dateTime={row.original.createdAt}
            className="block font-mono text-[11px] leading-4 text-[#65736d] dark:text-dark-text-secondary"
          >
            <span className="block">{occurredAt.format("MMM D, YYYY")}</span>
            <span className="block text-[#8a9790] dark:text-dark-text-tertiary">
              {occurredAt.format("HH:mm:ss")}
            </span>
          </time>
        );
      },
    },
    {
      id: "actor",
      header: "Actor",
      size: 235,
      cell: ({ row }) => <Actor actor={row.original.actor} />,
    },
    {
      id: "activity",
      header: "Activity",
      size: 420,
      cell: ({ row }) => (
        <div>
          <p className="max-w-xl text-[13px] font-medium leading-5 text-[#20362e] dark:text-dark-text-primary">
            {formatAuditActivity(row.original)}
          </p>
          <span className="mt-1.5 inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[#718078] dark:text-dark-text-secondary">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                auditActionDot(row.original.action),
              )}
            />
            {formatAuditAction(row.original.action)}
          </span>
        </div>
      ),
    },
    {
      id: "target",
      header: "Target",
      size: 210,
      cell: ({ row }) =>
        row.original.entityType ? (
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[#31463e] dark:text-dark-text-primary">
              {titleCase(row.original.entityType)}
            </p>
            {row.original.entityId && (
              <p
                className="truncate font-mono text-[10px] text-[#8a9790] dark:text-dark-text-secondary"
                title={row.original.entityId}
              >
                {shortIdentifier(row.original.entityId)}
              </p>
            )}
          </div>
        ) : (
          <span className="text-[#718078]">—</span>
        ),
    },
    {
      accessorKey: "ipAddress",
      header: "IP address",
      size: 135,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-[#65736d] dark:text-dark-text-secondary">
          {row.original.ipAddress || "—"}
        </span>
      ),
    },
    {
      id: "details",
      header: () => <span className="sr-only">Details</span>,
      size: 64,
      cell: ({ row }) => {
        const expanded = expandedId === row.original.id;
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setExpandedId((current) =>
                current === row.original.id ? null : row.original.id,
              )
            }
            aria-expanded={expanded}
            aria-label={
              expanded ? "Hide audit event details" : "View audit event details"
            }
            className="h-8 w-8 rounded-full text-[#65736d] hover:bg-[#e8f1ec] hover:text-[#075c41]"
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </Button>
        );
      },
    },
  ];

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (actorFilter) params.set("userId", actorFilter);
    if (actionFilter) params.set("action", actionFilter);
    if (entityFilter) params.set("entityType", entityFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    setIsExporting(true);
    try {
      const queryString = params.toString();
      const blob = await fetchBlobWithAuth(
        `/audit/export${queryString ? `?${queryString}` : ""}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      toast.error(
        exportError instanceof Error
          ? exportError.message
          : "Could not export audit log",
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f5f7f4] dark:bg-dark-primary">
      <header className="shrink-0 border-b border-[#dce3de] bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/60 dark:text-emerald-300">
            <ShieldCheck className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold leading-none">Audit log</h1>
              <Badge variant="outline" className="px-2 py-0 text-[10px]">
                {data?.pagination.total ?? 0} events
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
              Security and workspace activity, newest first.
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <ServerDataTable
          columns={columns}
          data={data?.data ?? []}
          rowCount={data?.pagination.total ?? 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          toolbarLeading={
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#d7e0da] bg-white text-[#0b7a55] dark:border-dark-border dark:bg-dark-elevated dark:text-emerald-300">
                <Activity className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[#31463e] dark:text-dark-text-primary">
                  Activity stream
                </p>
                <p className="hidden truncate text-[10px] text-[#7a8881] sm:block dark:text-dark-text-secondary">
                  Select an event to inspect its metadata.
                </p>
              </div>
            </div>
          }
          toolbarActions={
            <div className="flex items-center gap-0.5 rounded-lg border border-[#d7e0da] bg-white p-0.5 shadow-sm dark:border-dark-border dark:bg-dark-elevated">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFilters((current) => !current)}
                className={cn(
                  "h-8 rounded-md px-2.5 text-xs",
                  showFilters &&
                    "bg-[#e8f1ec] text-[#075c41] dark:bg-dark-tertiary dark:text-emerald-300",
                )}
                aria-expanded={showFilters}
              >
                <Filter className="mr-1.5 h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-1.5 grid min-w-4 place-items-center rounded-full bg-[#0b7a55] px-1 py-0.5 text-[9px] font-bold leading-none text-white">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              {canExport && (
                <>
                  <span className="mx-0.5 h-5 w-px bg-[#e1e7e3] dark:bg-dark-border" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleExport()}
                    disabled={isExporting}
                    className="h-8 rounded-md px-2.5 text-xs"
                  >
                    <FileDown className="mr-1.5 h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {isExporting ? "Exporting…" : "Export"}
                    </span>
                    <span className="sm:hidden">CSV</span>
                  </Button>
                </>
              )}
            </div>
          }
          toolbarPanel={
            showFilters ? (
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#31463e] dark:text-dark-text-primary">
                      Filter audit events
                    </p>
                    <p className="text-[11px] text-[#718078] dark:text-dark-text-secondary">
                      Filters are applied on the server.
                    </p>
                  </div>
                  {hasFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="h-8 text-[#0b7a55]"
                    >
                      Clear all
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <FilterSelect
                    label="Actor"
                    value={actorFilter}
                    onChange={(value) => setFilter("actor", value)}
                  >
                    <option value="">All actors</option>
                    {actors?.map((actor) => (
                      <option key={actor.id} value={actor.id}>
                        {actor.name || actor.email}
                      </option>
                    ))}
                  </FilterSelect>
                  <FilterSelect
                    label="Action"
                    value={actionFilter}
                    onChange={(value) => setFilter("action", value)}
                  >
                    <option value="">All actions</option>
                    {actions?.map((action) => (
                      <option key={action.value} value={action.value}>
                        {action.label}
                      </option>
                    ))}
                  </FilterSelect>
                  <FilterSelect
                    label="Entity"
                    value={entityFilter}
                    onChange={(value) => setFilter("entity", value)}
                  >
                    <option value="">All entities</option>
                    {entityTypes.map((entity) => (
                      <option key={entity} value={entity}>
                        {titleCase(entity)}
                      </option>
                    ))}
                  </FilterSelect>
                  <label className="text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
                    From
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(event) =>
                        setFilter("startDate", event.target.value)
                      }
                      className="mt-1 h-9"
                    />
                  </label>
                  <label className="text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
                    To
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(event) =>
                        setFilter("endDate", event.target.value)
                      }
                      className="mt-1 h-9"
                    />
                  </label>
                </div>
              </div>
            ) : undefined
          }
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          getRowId={(log) => log.id}
          renderSubRow={(log) =>
            expandedId === log.id ? <AuditDetails log={log} /> : null
          }
          tableLabel="Workspace audit log"
          emptyTitle="No activity matches these filters"
          emptyDescription={
            hasFilters
              ? "Clear or adjust the filters to see more events."
              : "Workspace activity will appear here as it happens."
          }
          pageSizeOptions={[10, 20, 50]}
          density="compact"
          tableClassName="min-w-[68rem]"
          className="min-h-0"
        />
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-[#dce3de] bg-white px-2 text-sm text-[#10211b] dark:border-dark-border dark:bg-dark-elevated dark:text-dark-text-primary"
      >
        {children}
      </select>
    </label>
  );
}

function Actor({ actor }: { actor: AuditLogType["actor"] }) {
  const displayName = actor?.name || actor?.email || "System";
  const initials = actor
    ? displayName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase()
    : null;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="bg-[#e8f1ec] text-[10px] font-bold text-[#075c41] dark:bg-emerald-950/50 dark:text-emerald-300">
          {initials || <Activity className="h-3.5 w-3.5" />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-[#31463e] dark:text-dark-text-primary">
          {displayName}
        </p>
        {actor?.name && (
          <p className="truncate text-[10px] text-[#718078] dark:text-dark-text-secondary">
            {actor.email}
          </p>
        )}
      </div>
    </div>
  );
}

function AuditDetails({ log }: { log: AuditLogType }) {
  const sanitizedDetails = sanitizeAuditDetails(log.details || {}) as Record<
    string,
    unknown
  >;
  const details = Object.entries(sanitizedDetails);
  return (
    <div className="space-y-3">
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {log.entityType && (
          <Detail label="Target type" value={titleCase(log.entityType)} />
        )}
        {log.entityId && <Detail label="Target ID" value={log.entityId} mono />}
        {details.map(([key, value]) => (
          <Detail
            key={key}
            label={titleCase(key)}
            value={formatDetailValue(value)}
          />
        ))}
      </dl>
      {log.details && (
        <details className="text-xs text-[#65736d] dark:text-dark-text-secondary">
          <summary className="cursor-pointer font-medium">
            Raw event data
          </summary>
          <pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-[#edf1ed] p-3 dark:bg-dark-primary">
            {JSON.stringify(Object.fromEntries(details), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-[#65736d] dark:text-dark-text-secondary">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 break-words font-medium",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function formatAuditSummary(log: AuditLogType): string {
  const actor = log.actor?.name || log.actor?.email || "System";
  const details = log.details || {};
  const target = String(
    details.memberName ||
      details.contactName ||
      details.email ||
      details.targetName ||
      (log.entityType
        ? `${titleCase(log.entityType)}${log.entityId ? ` ${log.entityId.slice(0, 8)}` : ""}`
        : "record"),
  );
  switch (log.action) {
    case "member.role_changed":
      return `${actor} changed ${target}'s role from ${titleCase(String(details.oldRole || "member"))} to ${titleCase(String(details.newRole || "member"))}.`;
    case "member.removed":
      return `${actor} removed ${target} from the workspace.`;
    case "invitation.sent":
      return `${actor} invited ${target} to the workspace.`;
    case "invitation.cancelled":
      return `${actor} cancelled the invitation for ${target}.`;
    case "invitation.resent":
      return `${actor} resent the invitation to ${target}.`;
    case "company.updated":
      return `${actor} updated workspace settings.`;
    case "contact.assigned":
      return `${actor} assigned ${target}.`;
    case "contact.unassigned":
      return `${actor} unassigned ${target}.`;
    case "conversation.resolved":
      return `${actor} resolved ${target}.`;
    case "conversation.reopened":
      return `${actor} reopened ${target}.`;
    default:
      return `${actor} performed ${formatAuditAction(log.action).toLocaleLowerCase()} on ${target}.`;
  }
}

function formatAuditActivity(log: AuditLogType): string {
  const actor = log.actor?.name || log.actor?.email || "System";
  const summary = formatAuditSummary(log);
  const description = summary.startsWith(`${actor} `)
    ? summary.slice(actor.length + 1)
    : summary;
  return description.charAt(0).toUpperCase() + description.slice(1);
}

function auditActionDot(action: AuditAction): string {
  const category = action.split(".")[0];
  switch (category) {
    case "invitation":
      return "bg-emerald-500";
    case "member":
      return "bg-amber-500";
    case "contact":
      return "bg-cyan-500";
    case "conversation":
      return "bg-blue-500";
    case "message":
      return "bg-violet-500";
    case "company":
      return "bg-teal-500";
    default:
      return "bg-slate-400";
  }
}

function shortIdentifier(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function titleCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isSensitiveDetail(key: string): boolean {
  return /(token|password|secret|authorization|access.?key)/i.test(key);
}

function sanitizeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSensitiveDetail(key))
        .map(([key, entry]) => [key, sanitizeAuditDetails(entry)]),
    );
  }
  return value;
}
