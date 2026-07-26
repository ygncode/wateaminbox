import { formatAuditTime } from "@wateaminbox/shared";
import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  Filter,
  Info,
} from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
  const page = Math.max(0, Number(searchParams.get("page")) || 0);
  const actionFilter = (searchParams.get("action") || "") as AuditAction | "";
  const actorFilter = searchParams.get("actor") || "";
  const entityFilter = searchParams.get("entity") || "";
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";
  const hasFilters = Boolean(
    actionFilter || actorFilter || entityFilter || startDate || endDate,
  );
  const [showFilters, setShowFilters] = useState(hasFilters);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 25;

  const { data, isLoading, error } = useAuditLogs(companyId, {
    userId: actorFilter || undefined,
    action: actionFilter || undefined,
    entityType: entityFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    limit,
    offset: page * limit,
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
  const setPage = (nextPage: number) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage > 0) next.set("page", String(nextPage));
      else next.delete("page");
      return next;
    });
  };

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
    <div className="flex h-full flex-col bg-[#f5f7f4] dark:bg-dark-primary">
      <header className="border-b border-[#dce3de] bg-white px-4 py-4 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[#0b7a55]">Workspace</p>
            <h1 className="text-xl font-semibold">Audit log</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((current) => !current)}
              className={cn(
                showFilters && "bg-[#edf1ed] dark:bg-dark-tertiary",
              )}
              aria-expanded={showFilters}
            >
              <Filter className="mr-2 h-4 w-4" /> Filters
              {hasFilters && (
                <span className="ml-2 h-2 w-2 rounded-full bg-[#0b7a55]" />
              )}
            </Button>
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExport()}
                disabled={isExporting}
              >
                <FileDown className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">
                  {isExporting ? "Exporting…" : "Export CSV"}
                </span>
                <span className="sm:hidden">Export</span>
              </Button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 grid gap-3 border-t border-[#dce3de] pt-4 dark:border-dark-border sm:grid-cols-2 xl:grid-cols-5">
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
                onChange={(event) => setFilter("startDate", event.target.value)}
                className="mt-1 h-9"
              />
            </label>
            <label className="text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
              To
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setFilter("endDate", event.target.value)}
                className="mt-1 h-9"
              />
            </label>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchParams({})}
                className="justify-self-start text-[#0b7a55]"
              >
                Clear filters
              </Button>
            )}
          </div>
        )}
      </header>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-3 p-4 sm:p-6" aria-busy="true">
            {[1, 2, 3, 4, 5].map((item) => (
              <Skeleton key={item} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <EmptyState title="Could not load the audit log" tone="error" />
        ) : !data?.data.length ? (
          <EmptyState title="No activity matches these filters" />
        ) : (
          <>
            <div className="hidden p-6 md:block">
              <div className="overflow-hidden rounded-xl border border-[#dce3de] bg-white dark:border-dark-border dark:bg-dark-elevated">
                <table className="w-full table-fixed text-left">
                  <thead className="bg-[#edf1ed] text-[11px] uppercase tracking-[0.12em] text-[#65736d] dark:bg-dark-tertiary dark:text-dark-text-secondary">
                    <tr>
                      <th className="w-40 px-4 py-3">Time</th>
                      <th className="w-52 px-4 py-3">Actor</th>
                      <th className="px-4 py-3">Activity</th>
                      <th className="w-36 px-4 py-3">IP address</th>
                      <th className="w-24 px-4 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6ebe7] dark:divide-dark-border">
                    {data.data.map((log) => (
                      <AuditTableRows
                        key={log.id}
                        log={log}
                        expanded={expandedId === log.id}
                        onToggle={() =>
                          setExpandedId((current) =>
                            current === log.id ? null : log.id,
                          )
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="space-y-3 p-4 md:hidden">
              {data.data.map((log) => (
                <AuditTimelineItem
                  key={log.id}
                  log={log}
                  expanded={expandedId === log.id}
                  onToggle={() =>
                    setExpandedId((current) =>
                      current === log.id ? null : log.id,
                    )
                  }
                />
              ))}
            </div>
          </>
        )}
      </ScrollArea>

      {data && data.pagination.total > limit && (
        <footer className="flex items-center justify-between border-t border-[#dce3de] bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
          <p className="text-xs text-[#65736d] dark:text-dark-text-secondary">
            {page * limit + 1}–
            {Math.min((page + 1) * limit, data.pagination.total)} of{" "}
            {data.pagination.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={!data.pagination.hasMore}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </footer>
      )}
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

function AuditTableRows({
  log,
  expanded,
  onToggle,
}: {
  log: AuditLogType;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="align-top hover:bg-[#f8faf8] dark:hover:bg-dark-tertiary/50">
        <td className="px-4 py-4 font-mono text-xs text-[#65736d] dark:text-dark-text-secondary">
          {formatAuditTime(log.createdAt)}
        </td>
        <td className="px-4 py-4">
          <Actor actor={log.actor} />
        </td>
        <td className="px-4 py-4">
          <p className="text-sm leading-5">{formatAuditSummary(log)}</p>
          <Badge variant="secondary" className="mt-2 text-[10px]">
            {formatAuditAction(log.action)}
          </Badge>
        </td>
        <td className="truncate px-4 py-4 font-mono text-xs text-[#65736d] dark:text-dark-text-secondary">
          {log.ipAddress || "—"}
        </td>
        <td className="px-4 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "View"}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={5}
            className="bg-[#f8faf8] px-4 py-4 dark:bg-dark-tertiary/40"
          >
            <AuditDetails log={log} />
          </td>
        </tr>
      )}
    </>
  );
}

function AuditTimelineItem({
  log,
  expanded,
  onToggle,
}: {
  log: AuditLogType;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="rounded-xl border border-[#dce3de] bg-white p-4 dark:border-dark-border dark:bg-dark-elevated">
      <div className="flex items-start justify-between gap-3">
        <Actor actor={log.actor} />
        <time className="shrink-0 font-mono text-[10px] text-[#65736d] dark:text-dark-text-secondary">
          {formatAuditTime(log.createdAt)}
        </time>
      </div>
      <p className="mt-3 text-sm leading-6">{formatAuditSummary(log)}</p>
      <div className="mt-3 flex items-center justify-between">
        <Badge variant="secondary" className="text-[10px]">
          {formatAuditAction(log.action)}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? "Hide details" : "Details"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-[#dce3de] pt-3 dark:border-dark-border">
          <AuditDetails log={log} />
        </div>
      )}
    </article>
  );
}

function Actor({ actor }: { actor: AuditLogType["actor"] }) {
  return actor ? (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">
        {actor.name || actor.email}
      </p>
      {actor.name && (
        <p className="truncate text-xs text-[#65736d] dark:text-dark-text-secondary">
          {actor.email}
        </p>
      )}
    </div>
  ) : (
    <span className="text-sm text-[#65736d] dark:text-dark-text-secondary">
      System
    </span>
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

function EmptyState({
  title,
  tone = "default",
}: {
  title: string;
  tone?: "default" | "error";
}) {
  return (
    <div
      className={cn(
        "grid h-64 place-items-center px-4 text-center",
        tone === "error"
          ? "text-red-600 dark:text-red-400"
          : "text-[#65736d] dark:text-dark-text-secondary",
      )}
    >
      <div>
        <Info className="mx-auto h-10 w-10 opacity-40" />
        <p className="mt-3 text-sm">{title}</p>
      </div>
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
