import {
  SLA_RESOLUTION_TARGET_MINUTES_MAX,
  SLA_RESOLUTION_TARGET_MINUTES_MIN,
  SLA_TARGET_MINUTES_MAX,
  SLA_TARGET_MINUTES_MIN,
} from "@wateaminbox/shared";
import { CircleAlert, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useCreateSlaPolicy,
  useCurrentSlaPolicy,
  useSlaPolicyHistory,
} from "@/hooks/useSlaPolicy";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  daysToScheduleInput,
  type EditableDay,
  type EditableException,
  type EditableInterval,
  exceptionsToInput,
  formatIntervals,
  newEditableInterval,
  toEditableDays,
  toEditableExceptions,
} from "./sla-policy-form";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAY_KEYS = [
  "sla.weekdays.sunday",
  "sla.weekdays.monday",
  "sla.weekdays.tuesday",
  "sla.weekdays.wednesday",
  "sla.weekdays.thursday",
  "sla.weekdays.friday",
  "sla.weekdays.saturday",
];

function weekdayLabel(t: TFunction, weekday: number): string {
  return t(WEEKDAY_KEYS[weekday], WEEKDAY_LABELS[weekday]);
}

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Yangon",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function listTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf?.("timeZone");
  return supported && supported.length > 0 ? supported : FALLBACK_TIMEZONES;
}

function SettingsPanel({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6">
      {title && <h3 className="font-semibold">{title}</h3>}
      {description && (
        <p className="mb-5 mt-1 text-sm leading-6 text-[#65736d] dark:text-dark-text-secondary">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

export function SlaPolicySettings() {
  const { t } = useTranslation();

  const { activeWorkspace } = useWorkspace();
  const companyId = activeWorkspace?.id ?? "";
  const canEdit =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const { data: policy, isLoading, isError } = useCurrentSlaPolicy(companyId);
  const { data: history } = useSlaPolicyHistory(companyId);
  const createPolicy = useCreateSlaPolicy(companyId);

  const [editing, setEditing] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [targetMinutes, setTargetMinutes] = useState("60");
  const [directResolutionTargetMinutes, setDirectResolutionTargetMinutes] =
    useState("480");
  const [groupResponseTargetMinutes, setGroupResponseTargetMinutes] =
    useState("120");
  const [groupResolutionTargetMinutes, setGroupResolutionTargetMinutes] =
    useState("960");
  const [days, setDays] = useState<EditableDay[]>(() => toEditableDays([]));
  const [exceptions, setExceptions] = useState<EditableException[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!policy) return;
    setTimezone(policy.timezone);
    setTargetMinutes(String(policy.targetMinutes));
    setDirectResolutionTargetMinutes(
      String(policy.directResolutionTargetMinutes),
    );
    setGroupResponseTargetMinutes(String(policy.groupResponseTargetMinutes));
    setGroupResolutionTargetMinutes(
      String(policy.groupResolutionTargetMinutes),
    );
    setDays(toEditableDays(policy.weeklySchedule));
    setExceptions(toEditableExceptions(policy.exceptions));
  }, [policy]);

  if (isLoading) {
    return (
      <SettingsPanel title={t("sla.title", "Response SLA")}>
        <div className="flex items-center gap-2 text-sm text-[#65736d] dark:text-dark-text-secondary">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("sla.loading", "Loading SLA policy…")}
        </div>
      </SettingsPanel>
    );
  }

  if (isError || !policy) {
    return (
      <SettingsPanel title={t("sla.title", "Response SLA")}>
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("sla.loadFailed", "Could not load the SLA policy.")}
        </p>
      </SettingsPanel>
    );
  }

  const isValidTarget = (value: string, min: number, max: number) => {
    const n = Number(value);
    return value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
  };

  const targetMinutesValue = Number(targetMinutes);
  const directResolutionTargetMinutesValue = Number(
    directResolutionTargetMinutes,
  );
  const groupResponseTargetMinutesValue = Number(groupResponseTargetMinutes);
  const groupResolutionTargetMinutesValue = Number(
    groupResolutionTargetMinutes,
  );
  const targetValid = isValidTarget(
    targetMinutes,
    SLA_TARGET_MINUTES_MIN,
    SLA_TARGET_MINUTES_MAX,
  );
  const directResolutionValid = isValidTarget(
    directResolutionTargetMinutes,
    SLA_RESOLUTION_TARGET_MINUTES_MIN,
    SLA_RESOLUTION_TARGET_MINUTES_MAX,
  );
  const groupResponseValid = isValidTarget(
    groupResponseTargetMinutes,
    SLA_TARGET_MINUTES_MIN,
    SLA_TARGET_MINUTES_MAX,
  );
  const groupResolutionValid = isValidTarget(
    groupResolutionTargetMinutes,
    SLA_RESOLUTION_TARGET_MINUTES_MIN,
    SLA_RESOLUTION_TARGET_MINUTES_MAX,
  );
  const atLeastOneOpenDay = days.some((d) => d.open);

  const updateDay = (weekday: number, patch: Partial<EditableDay>) => {
    setDays((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  };

  const addDayInterval = (weekday: number) => {
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? { ...d, intervals: [...d.intervals, newEditableInterval()] }
          : d,
      ),
    );
  };

  const updateDayInterval = (
    weekday: number,
    intervalKey: string,
    patch: Partial<EditableInterval>,
  ) => {
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? {
              ...d,
              intervals: d.intervals.map((interval) =>
                interval.key === intervalKey
                  ? { ...interval, ...patch }
                  : interval,
              ),
            }
          : d,
      ),
    );
  };

  const removeDayInterval = (weekday: number, intervalKey: string) => {
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? {
              ...d,
              intervals: d.intervals.filter(
                (interval) => interval.key !== intervalKey,
              ),
            }
          : d,
      ),
    );
  };

  const addException = () => {
    setExceptions((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        date: "",
        closed: true,
        label: "",
        intervals: [newEditableInterval()],
      },
    ]);
  };

  const updateException = (key: string, patch: Partial<EditableException>) => {
    setExceptions((prev) =>
      prev.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    );
  };

  const removeException = (key: string) => {
    setExceptions((prev) => prev.filter((e) => e.key !== key));
  };

  const addExceptionInterval = (exceptionKey: string) => {
    setExceptions((prev) =>
      prev.map((e) =>
        e.key === exceptionKey
          ? { ...e, intervals: [...e.intervals, newEditableInterval()] }
          : e,
      ),
    );
  };

  const updateExceptionInterval = (
    exceptionKey: string,
    intervalKey: string,
    patch: Partial<EditableInterval>,
  ) => {
    setExceptions((prev) =>
      prev.map((e) =>
        e.key === exceptionKey
          ? {
              ...e,
              intervals: e.intervals.map((interval) =>
                interval.key === intervalKey
                  ? { ...interval, ...patch }
                  : interval,
              ),
            }
          : e,
      ),
    );
  };

  const removeExceptionInterval = (
    exceptionKey: string,
    intervalKey: string,
  ) => {
    setExceptions((prev) =>
      prev.map((e) =>
        e.key === exceptionKey
          ? {
              ...e,
              intervals: e.intervals.filter(
                (interval) => interval.key !== intervalKey,
              ),
            }
          : e,
      ),
    );
  };

  const startEditing = () => {
    setTimezone(policy.timezone);
    setTargetMinutes(String(policy.targetMinutes));
    setDirectResolutionTargetMinutes(
      String(policy.directResolutionTargetMinutes),
    );
    setGroupResponseTargetMinutes(String(policy.groupResponseTargetMinutes));
    setGroupResolutionTargetMinutes(
      String(policy.groupResolutionTargetMinutes),
    );
    setDays(toEditableDays(policy.weeklySchedule));
    setExceptions(toEditableExceptions(policy.exceptions));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setError(null);
    if (!targetValid) {
      setError(
        t("sla.errors.directResponse", {
          defaultValue:
            "Direct response target must be a whole number between {{min}} and {{max}} minutes.",
          min: SLA_TARGET_MINUTES_MIN,
          max: SLA_TARGET_MINUTES_MAX,
        }),
      );
      return;
    }
    if (!directResolutionValid) {
      setError(
        t("sla.errors.directResolution", {
          defaultValue:
            "Direct resolution target must be a whole number between {{min}} and {{max}} minutes.",
          min: SLA_RESOLUTION_TARGET_MINUTES_MIN,
          max: SLA_RESOLUTION_TARGET_MINUTES_MAX,
        }),
      );
      return;
    }
    if (!groupResponseValid) {
      setError(
        t("sla.errors.groupResponse", {
          defaultValue:
            "Group response target must be a whole number between {{min}} and {{max}} minutes.",
          min: SLA_TARGET_MINUTES_MIN,
          max: SLA_TARGET_MINUTES_MAX,
        }),
      );
      return;
    }
    if (!groupResolutionValid) {
      setError(
        t("sla.errors.groupResolution", {
          defaultValue:
            "Group resolution target must be a whole number between {{min}} and {{max}} minutes.",
          min: SLA_RESOLUTION_TARGET_MINUTES_MIN,
          max: SLA_RESOLUTION_TARGET_MINUTES_MAX,
        }),
      );
      return;
    }
    if (!atLeastOneOpenDay) {
      setError(
        t(
          "sla.errors.noOpenDay",
          "At least one weekday must be open with an interval.",
        ),
      );
      return;
    }
    const openDayMissingInterval = days.find(
      (d) => d.open && d.intervals.length === 0,
    );
    if (openDayMissingInterval) {
      setError(
        t("sla.errors.dayMissingInterval", {
          defaultValue:
            "{{day}} is open but has no interval - add one or mark it closed.",
          day: weekdayLabel(t, openDayMissingInterval.weekday),
        }),
      );
      return;
    }
    const missingDate = exceptions.find((e) => !e.date);
    if (missingDate) {
      setError(
        t("sla.errors.exceptionNeedsDate", "Every exception needs a date."),
      );
      return;
    }
    const duplicateDates =
      new Set(exceptions.map((e) => e.date)).size !== exceptions.length;
    if (duplicateDates) {
      setError(
        t(
          "sla.errors.duplicateExceptionDates",
          "Exception dates must be unique.",
        ),
      );
      return;
    }
    const customExceptionMissingInterval = exceptions.find(
      (e) => !e.closed && e.intervals.length === 0,
    );
    if (customExceptionMissingInterval) {
      setError(
        t("sla.errors.exceptionMissingInterval", {
          defaultValue:
            "The {{date}} exception needs at least one interval, or mark it closed.",
          date: customExceptionMissingInterval.date || t("sla.newDate", "new"),
        }),
      );
      return;
    }

    try {
      await createPolicy.mutateAsync({
        targetMinutes: targetMinutesValue,
        directResolutionTargetMinutes: directResolutionTargetMinutesValue,
        groupResponseTargetMinutes: groupResponseTargetMinutesValue,
        groupResolutionTargetMinutes: groupResolutionTargetMinutesValue,
        timezone,
        weeklySchedule: daysToScheduleInput(days),
        exceptions: exceptionsToInput(exceptions),
      });
      toast.success(t("sla.updated", "SLA policy updated"));
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("sla.updateFailed", "Could not update the SLA policy"),
      );
    }
  };

  if (!editing) {
    return (
      <div className="space-y-5">
        <SettingsPanel
          title={t("sla.title", "Response SLA")}
          description={t(
            "sla.description",
            "The response and resolution targets and the shared business-hours calendar used across the dashboard's SLA compliance and breach reporting. Time outside open hours pauses both SLA clocks. Group SLA is measured per group conversation, not per member - one team reply acknowledges the whole inbound burst.",
          )}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#e6ebe7] p-4 dark:border-dark-border">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#829089]">
                {t("sla.directChats", "Direct chats")}
              </p>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs font-medium text-[#829089]">
                    {t("sla.responseTarget", "Response target")}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {t("sla.minutes", {
                      defaultValue: "{{count}} minutes",
                      count: policy.targetMinutes,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-[#829089]">
                    {t("sla.resolutionTarget", "Resolution target")}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {t("sla.minutes", {
                      defaultValue: "{{count}} minutes",
                      count: policy.directResolutionTargetMinutes,
                    })}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="rounded-xl border border-[#e6ebe7] p-4 dark:border-dark-border">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#829089]">
                {t("sla.groupChats", "Group chats")}
              </p>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs font-medium text-[#829089]">
                    {t("sla.responseTarget", "Response target")}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {t("sla.minutes", {
                      defaultValue: "{{count}} minutes",
                      count: policy.groupResponseTargetMinutes,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-[#829089]">
                    {t("sla.resolutionTarget", "Resolution target")}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold">
                    {t("sla.minutes", {
                      defaultValue: "{{count}} minutes",
                      count: policy.groupResolutionTargetMinutes,
                    })}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-4">
            <dt className="text-xs font-medium text-[#829089]">
              {t("sla.timezone", "Timezone")}
            </dt>
            <dd className="mt-1 text-sm font-semibold">{policy.timezone}</dd>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-[#829089]">
              {t("sla.weeklyHours", "Weekly hours")}
            </p>
            <div className="space-y-1">
              {policy.weeklySchedule
                .slice()
                .sort((a, b) => a.weekday - b.weekday)
                .map((day) => (
                  <div
                    key={day.weekday}
                    className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm odd:bg-[#f8faf8] dark:odd:bg-dark-tertiary/30"
                  >
                    <span className="text-[#40544c] dark:text-dark-text-primary">
                      {weekdayLabel(t, day.weekday)}
                    </span>
                    <span
                      className={
                        day.open
                          ? "font-medium text-[#203b32] dark:text-dark-text-primary"
                          : "text-[#87928c] dark:text-dark-text-secondary"
                      }
                    >
                      {formatIntervals(day, t)}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {policy.exceptions.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-medium text-[#829089]">
                {t("sla.dateExceptions", "Date exceptions")}
              </p>
              <div className="space-y-1">
                {policy.exceptions.map((exception) => (
                  <div
                    key={exception.date}
                    className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm odd:bg-[#f8faf8] dark:odd:bg-dark-tertiary/30"
                  >
                    <span className="text-[#40544c] dark:text-dark-text-primary">
                      {exception.date}
                      {exception.label ? ` – ${exception.label}` : ""}
                    </span>
                    <span
                      className={
                        exception.closed
                          ? "text-[#87928c] dark:text-dark-text-secondary"
                          : "font-medium text-[#203b32] dark:text-dark-text-primary"
                      }
                    >
                      {exception.closed
                        ? t("sla.closed", "Closed")
                        : (exception.intervals ?? [])
                            .map((i) => `${i.start}–${i.end}`)
                            .join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history && history.length > 1 && (
            <p className="mt-5 text-xs text-[#87928c] dark:text-dark-text-secondary">
              {history.length} policy versions in history. Editing creates a new
              version effective immediately - past and in-progress conversations
              keep using the policy that was active when they began.
            </p>
          )}

          {canEdit && (
            <div className="mt-5 flex justify-end border-t border-[#e6ebe7] pt-5 dark:border-dark-border">
              <Button
                type="button"
                variant="outline"
                onClick={startEditing}
                className="gap-2"
              >
                {t("sla.editPolicy", "Edit SLA policy")}
              </Button>
            </div>
          )}
        </SettingsPanel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SettingsPanel
        title={t("sla.editTitle", "Edit response SLA")}
        description={t(
          "sla.editDescription",
          "Changes take effect immediately as a new policy version. Past and already-open conversations keep using the policy that was active when they began.",
        )}
      >
        <div className="space-y-6">
          <p className="text-xs text-[#65736d] dark:text-dark-text-secondary">
            {t(
              "sla.editIntro",
              "Direct and group chats share the same timezone, business hours, and holidays below, but have their own response and resolution targets. Group SLA is measured for the whole group conversation, not per member - one team reply acknowledges the inbound burst from any participant.",
            )}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="rounded-xl border border-[#e6ebe7] p-4 dark:border-dark-border">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[#829089]">
                {t("sla.directChats", "Direct chats")}
              </legend>
              <div className="space-y-4">
                <label className="block text-sm font-medium">
                  {t("sla.responseTargetMinutes", "Response target (minutes)")}
                  <Input
                    type="number"
                    min={SLA_TARGET_MINUTES_MIN}
                    max={SLA_TARGET_MINUTES_MAX}
                    step={1}
                    className="mt-2"
                    value={targetMinutes}
                    onChange={(event) => setTargetMinutes(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium">
                  {t(
                    "sla.resolutionTargetMinutes",
                    "Resolution target (minutes)",
                  )}
                  <Input
                    type="number"
                    min={SLA_RESOLUTION_TARGET_MINUTES_MIN}
                    max={SLA_RESOLUTION_TARGET_MINUTES_MAX}
                    step={1}
                    className="mt-2"
                    value={directResolutionTargetMinutes}
                    onChange={(event) =>
                      setDirectResolutionTargetMinutes(event.target.value)
                    }
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className="rounded-xl border border-[#e6ebe7] p-4 dark:border-dark-border">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[#829089]">
                {t("sla.groupChats", "Group chats")}
              </legend>
              <div className="space-y-4">
                <label className="block text-sm font-medium">
                  {t("sla.responseTargetMinutes", "Response target (minutes)")}
                  <Input
                    type="number"
                    min={SLA_TARGET_MINUTES_MIN}
                    max={SLA_TARGET_MINUTES_MAX}
                    step={1}
                    className="mt-2"
                    value={groupResponseTargetMinutes}
                    onChange={(event) =>
                      setGroupResponseTargetMinutes(event.target.value)
                    }
                  />
                </label>
                <label className="block text-sm font-medium">
                  {t(
                    "sla.resolutionTargetMinutes",
                    "Resolution target (minutes)",
                  )}
                  <Input
                    type="number"
                    min={SLA_RESOLUTION_TARGET_MINUTES_MIN}
                    max={SLA_RESOLUTION_TARGET_MINUTES_MAX}
                    step={1}
                    className="mt-2"
                    value={groupResolutionTargetMinutes}
                    onChange={(event) =>
                      setGroupResolutionTargetMinutes(event.target.value)
                    }
                  />
                </label>
              </div>
            </fieldset>
          </div>

          <label className="block text-sm font-medium">
            {t("sla.timezone", "Timezone")}
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="mt-2 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-dark-border dark:bg-dark-tertiary sm:w-1/2"
            >
              {listTimeZones().map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="mb-2 text-sm font-medium">
              {t("sla.weeklyHours", "Weekly hours")}
            </p>
            <p className="mb-3 text-xs text-[#87928c] dark:text-dark-text-secondary">
              {t(
                "sla.weeklyHoursHint",
                "A day can have multiple intervals (e.g. a lunch break split shift).",
              )}
            </p>
            <div className="space-y-2">
              {days.map((day) => (
                <div
                  key={day.weekday}
                  className="rounded-xl border border-[#e6ebe7] bg-[#f8faf8] px-3 py-2.5 dark:border-dark-border dark:bg-dark-tertiary/30"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={day.open}
                        onChange={(event) =>
                          updateDay(day.weekday, { open: event.target.checked })
                        }
                      />
                      {weekdayLabel(t, day.weekday)}
                    </label>
                    {day.open && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addDayInterval(day.weekday)}
                        className="gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" />{" "}
                        {t("sla.addInterval", "Add interval")}
                      </Button>
                    )}
                  </div>
                  {day.open ? (
                    <div className="mt-2 space-y-2">
                      {day.intervals.map((interval) => (
                        <div
                          key={interval.key}
                          className="flex flex-wrap items-center gap-2 text-sm"
                        >
                          <input
                            type="time"
                            value={interval.start}
                            onChange={(event) =>
                              updateDayInterval(day.weekday, interval.key, {
                                start: event.target.value,
                              })
                            }
                            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm dark:border-dark-border dark:bg-dark-tertiary"
                          />
                          <span className="text-[#87928c]">to</span>
                          <input
                            type="time"
                            value={interval.end}
                            disabled={interval.untilMidnight}
                            onChange={(event) =>
                              updateDayInterval(day.weekday, interval.key, {
                                end: event.target.value,
                              })
                            }
                            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm disabled:opacity-50 dark:border-dark-border dark:bg-dark-tertiary"
                          />
                          <label className="flex items-center gap-1.5 text-xs text-[#65736d] dark:text-dark-text-secondary">
                            <input
                              type="checkbox"
                              checked={interval.untilMidnight}
                              onChange={(event) =>
                                updateDayInterval(day.weekday, interval.key, {
                                  untilMidnight: event.target.checked,
                                })
                              }
                            />
                            {t("sla.untilMidnight", "Until midnight")}
                          </label>
                          {day.intervals.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                removeDayInterval(day.weekday, interval.key)
                              }
                              className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-[#87928c] dark:text-dark-text-secondary">
                      Closed
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">
                {t("sla.dateExceptions", "Date exceptions")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addException}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> {t("sla.addDate", "Add date")}
              </Button>
            </div>
            {exceptions.length === 0 ? (
              <p className="text-sm text-[#87928c] dark:text-dark-text-secondary">
                {t(
                  "sla.noExceptions",
                  "No holidays or custom-hours dates yet.",
                )}
              </p>
            ) : (
              <div className="space-y-2">
                {exceptions.map((exception) => (
                  <div
                    key={exception.key}
                    className="space-y-2 rounded-xl border border-[#e6ebe7] bg-[#f8faf8] p-3 dark:border-dark-border dark:bg-dark-tertiary/30"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={exception.date}
                        onChange={(event) =>
                          updateException(exception.key, {
                            date: event.target.value,
                          })
                        }
                        className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm dark:border-dark-border dark:bg-dark-tertiary"
                      />
                      <Input
                        placeholder={t(
                          "sla.exceptionLabelPlaceholder",
                          "Label (e.g. Christmas)",
                        )}
                        value={exception.label}
                        onChange={(event) =>
                          updateException(exception.key, {
                            label: event.target.value,
                          })
                        }
                        className="h-8 max-w-[220px]"
                      />
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="radio"
                          name={`exception-mode-${exception.key}`}
                          checked={exception.closed}
                          onChange={() =>
                            updateException(exception.key, { closed: true })
                          }
                        />
                        Closed
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="radio"
                          name={`exception-mode-${exception.key}`}
                          checked={!exception.closed}
                          onChange={() =>
                            updateException(exception.key, { closed: false })
                          }
                        />
                        {t("sla.customHours", "Custom hours")}
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeException(exception.key)}
                        className="ml-auto gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />{" "}
                        {t("sla.remove", "Remove")}
                      </Button>
                    </div>
                    {!exception.closed && (
                      <div className="space-y-2">
                        {exception.intervals.map((interval) => (
                          <div
                            key={interval.key}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <input
                              type="time"
                              value={interval.start}
                              onChange={(event) =>
                                updateExceptionInterval(
                                  exception.key,
                                  interval.key,
                                  { start: event.target.value },
                                )
                              }
                              className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm dark:border-dark-border dark:bg-dark-tertiary"
                            />
                            <span className="text-[#87928c]">to</span>
                            <input
                              type="time"
                              value={interval.end}
                              disabled={interval.untilMidnight}
                              onChange={(event) =>
                                updateExceptionInterval(
                                  exception.key,
                                  interval.key,
                                  { end: event.target.value },
                                )
                              }
                              className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm disabled:opacity-50 dark:border-dark-border dark:bg-dark-tertiary"
                            />
                            <label className="flex items-center gap-1.5 text-xs text-[#65736d] dark:text-dark-text-secondary">
                              <input
                                type="checkbox"
                                checked={interval.untilMidnight}
                                onChange={(event) =>
                                  updateExceptionInterval(
                                    exception.key,
                                    interval.key,
                                    { untilMidnight: event.target.checked },
                                  )
                                }
                              />
                              {t("sla.untilMidnight", "Until midnight")}
                            </label>
                            {exception.intervals.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  removeExceptionInterval(
                                    exception.key,
                                    interval.key,
                                  )
                                }
                                className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addExceptionInterval(exception.key)}
                          className="gap-1.5"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add interval
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400"
            >
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-[#e6ebe7] pt-5 dark:border-dark-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={createPolicy.isPending}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={createPolicy.isPending}
              className="gap-2 bg-[#0b7a55] text-white hover:bg-[#096747]"
            >
              {createPolicy.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {createPolicy.isPending
                ? t("common.saving", "Saving…")
                : t("sla.saveChanges", "Save changes")}
            </Button>
          </div>
        </div>
      </SettingsPanel>
    </div>
  );
}
