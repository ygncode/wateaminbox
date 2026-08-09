import type { BulkJob, BulkJobPreview } from "@wateaminbox/shared";
import { dayjs } from "@wateaminbox/shared";
import {
  AlertTriangle,
  Check,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  ScanSearch,
  Send,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TagSearchInput } from "@/components/tags/TagSearchInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  StepContent,
  StepWizard,
  type StepWizardStep,
} from "@/components/ui/step-wizard";
import { Textarea } from "@/components/ui/textarea";
import { useTags } from "@/hooks/contact/useContactTags";
import { useDebounce } from "@/hooks/ui";
import { useCreateBulkJob, usePreviewBulkJob } from "@/hooks/useBulkJobs";
import { useWhatsAppConnectionsList } from "@/hooks/whatsapp";
import { ApiRequestError } from "@/lib/api/client";
import { uploadMedia } from "@/lib/api/messages";
import { cn } from "@/lib/utils";
import {
  formatScheduledTime,
  humanizeDuration,
  humanizeSkipReason,
  personalizeSample,
} from "./broadcast-format";
import { ContactMultiSelect } from "./ContactMultiSelect";

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_AUDIENCE_TAGS = 50;
/** Mirror of the server-side minimum lead time, with UI slack on top. */
const MIN_LEAD_MS = 60_000;

const WIZARD_STEPS: StepWizardStep[] = [
  { id: "audience", label: "Audience" },
  { id: "message", label: "Message" },
  { id: "preview", label: "Preview" },
  { id: "schedule", label: "Schedule" },
];

type WizardStep = "audience" | "message" | "preview" | "schedule";

const SCHEDULE_PRESETS = [
  { label: "In 1 hour", value: () => dayjs().add(1, "hour") },
  {
    label: "Tomorrow 9:00",
    value: () => dayjs().add(1, "day").hour(9).minute(0),
  },
  {
    label: "Next week 9:00",
    value: () => dayjs().add(7, "day").hour(9).minute(0),
  },
];

function toLocalInputValue(value: dayjs.Dayjs): string {
  return value.format("YYYY-MM-DDTHH:mm");
}

interface Attachment {
  file: File;
  previewUrl: string | null;
}

function attachmentIcon(file: File): typeof ImageIcon {
  if (file.type.startsWith("image/")) return ImageIcon;
  if (file.type.startsWith("video/")) return Film;
  return FileText;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CreateBroadcastWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (job: BulkJob) => void;
}

const STEP_ICONS: Record<WizardStep, typeof UsersRound> = {
  audience: UsersRound,
  message: MessageSquareText,
  preview: ScanSearch,
  schedule: Send,
};

function BroadcastStepProgress({ currentStep }: { currentStep: WizardStep }) {
  const currentIndex = WIZARD_STEPS.findIndex(
    (item) => item.id === currentStep,
  );

  return (
    <nav
      className="border-b border-[#e3e9e5] bg-[#fbfcfb] px-4 py-2.5 dark:border-dark-border dark:bg-dark-secondary/45 sm:px-6"
      aria-label="Broadcast creation progress"
    >
      <ol className="mx-auto grid max-w-2xl grid-cols-4 gap-1">
        {WIZARD_STEPS.map((item, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const Icon = STEP_ICONS[item.id as WizardStep];
          return (
            <li key={item.id} className="relative min-w-0">
              {index > 0 && (
                <span
                  className={cn(
                    "absolute right-1/2 top-3.5 h-px w-full -translate-y-1/2",
                    index <= currentIndex
                      ? "bg-[#7db69f] dark:bg-emerald-700"
                      : "bg-[#d7e0da] dark:bg-dark-border",
                  )}
                  aria-hidden="true"
                />
              )}
              <div className="relative z-10 flex flex-col items-center">
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-lg border text-[10px] font-bold transition-colors",
                    isComplete &&
                      "border-[#8fc1aa] bg-[#e2f1e9] text-[#087654] dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
                    isCurrent &&
                      "border-[#0b7a55] bg-[#0b7a55] text-white shadow-sm dark:border-emerald-500 dark:bg-emerald-600",
                    !isComplete &&
                      !isCurrent &&
                      "border-[#d7e0da] bg-white text-[#8a9790] dark:border-dark-border dark:bg-dark-elevated dark:text-dark-text-tertiary",
                  )}
                >
                  {isComplete ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </span>
                <span
                  className={cn(
                    "mt-1.5 max-w-full truncate text-[10px] font-semibold",
                    isCurrent || isComplete
                      ? "text-[#31463e] dark:text-dark-text-primary"
                      : "text-[#8a9790] dark:text-dark-text-tertiary",
                  )}
                >
                  {item.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Four-step dialog for creating a bulk broadcast: pick an audience, write a
 * personalized message, review the server preview, then schedule and confirm.
 */
export function CreateBroadcastWizard({
  open,
  onOpenChange,
  onCreated,
}: CreateBroadcastWizardProps) {
  const [step, setStep] = useState<WizardStep>("audience");

  // Audience
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const debouncedTagSearch = useDebounce(tagSearch.trim(), 250);
  const [selectedContacts, setSelectedContacts] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [connectionId, setConnectionId] = useState("all");

  // Message
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);

  // Preview
  const [preview, setPreview] = useState<BulkJobPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Schedule
  const [scheduleValue, setScheduleValue] = useState(() =>
    toLocalInputValue(dayjs().add(1, "hour").second(0)),
  );
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // One key per wizard session so a retried submit returns the original job.
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  // Reuse the durable upload across submit retries (audience-drift 409s,
  // transient create errors): re-running handleSubmit must not orphan a new
  // object per attempt. Keyed by file identity so a swapped file re-uploads.
  // Bounded limitation: there is no client-authorized media deletion, so an
  // abandoned or replaced attachment leaves at most one orphaned object per
  // wizard session.
  const uploadedMediaRef = useRef<{
    fileKey: string;
    mediaUrl: string;
    mimeType: string;
  } | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentUrlRef = useRef<string | null>(null);

  const { data: tags, isLoading: tagsLoading } = useTags({
    search: debouncedTagSearch || undefined,
    limit: 100,
  });
  const { data: connections = [] } = useWhatsAppConnectionsList();
  const previewMutation = usePreviewBulkJob();
  const createMutation = useCreateBulkJob();

  const activeConnections = useMemo(
    () => connections.filter((connection) => !connection.archivedAt),
    [connections],
  );

  const audience = useMemo(
    () => ({
      tagIds: selectedTagIds,
      contactIds: [...selectedContacts.keys()],
      connectionId: connectionId === "all" ? undefined : connectionId,
    }),
    [selectedTagIds, selectedContacts, connectionId],
  );

  const audienceCount = selectedTagIds.length + selectedContacts.size;

  const unknownTokens = useMemo(() => {
    const bad = new Set<string>();
    for (const match of content.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
      if (match[1] !== "name" && match[1] !== "firstName") bad.add(match[1]);
    }
    return [...bad];
  }, [content]);

  // Keep the object URL for the image thumbnail from leaking on unmount.
  useEffect(() => {
    attachmentUrlRef.current = attachment?.previewUrl ?? null;
  }, [attachment]);
  useEffect(
    () => () => {
      if (attachmentUrlRef.current) {
        URL.revokeObjectURL(attachmentUrlRef.current);
      }
    },
    [],
  );

  const { mutateAsync: previewAsync } = previewMutation;
  const runPreview = useCallback(async () => {
    setPreviewError(null);
    try {
      const result = await previewAsync({ audience, content });
      setPreview(result);
    } catch (error) {
      setPreview(null);
      setPreviewError(
        error instanceof Error ? error.message : "Failed to preview audience",
      );
    }
  }, [previewAsync, audience, content]);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((previous) =>
      previous.includes(tagId)
        ? previous.filter((id) => id !== tagId)
        : previous.length < MAX_AUDIENCE_TAGS
          ? [...previous, tagId]
          : previous,
    );
  };

  const toggleContact = (contactId: string, displayName: string) => {
    setSelectedContacts((previous) => {
      const next = new Map(previous);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.set(contactId, displayName);
      }
      return next;
    });
  };

  const insertToken = (token: "name" | "firstName") => {
    const text = `{{${token}}}`;
    const textarea = contentRef.current;
    if (!textarea) {
      setContent((previous) => previous + text);
      return;
    }
    const start = textarea.selectionStart ?? content.length;
    const end = textarea.selectionEnd ?? start;
    setContent(content.slice(0, start) + text + content.slice(end));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachment must be 50MB or smaller");
      return;
    }
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment({
      file,
      previewUrl: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null,
    });
  };

  const removeAttachment = () => {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
  };

  const sampleName = selectedContacts.values().next().value ?? "Alex Smith";

  const overMaxRecipients = Boolean(
    preview && preview.recipientCount > preview.limits.maxRecipientsPerJob,
  );
  const overDailyCap = Boolean(
    preview &&
      !overMaxRecipients &&
      preview.perConnection.some(
        (connection) =>
          connection.recipientCount > preview.limits.dailyCapPerConnection,
      ),
  );

  const canLeaveMessageStep =
    name.trim().length > 0 &&
    (content.trim().length > 0 || attachment !== null) &&
    unknownTokens.length === 0;

  const canLeavePreviewStep = Boolean(
    preview &&
      !previewMutation.isPending &&
      preview.recipientCount > 0 &&
      !overMaxRecipients,
  );

  const handleNext = () => {
    if (step === "audience" && audienceCount > 0) {
      setStep("message");
    } else if (step === "message" && canLeaveMessageStep) {
      setStep("preview");
      void runPreview();
    } else if (step === "preview" && canLeavePreviewStep) {
      setStep("schedule");
    }
  };

  const handleBack = () => {
    if (step === "message") setStep("audience");
    else if (step === "preview") setStep("message");
    else if (step === "schedule") setStep("preview");
  };

  const handleSubmit = async () => {
    if (!preview) return;
    const parsed = new Date(scheduleValue);
    if (Number.isNaN(parsed.getTime())) {
      setScheduleError("Enter a valid date and time");
      return;
    }
    if (parsed.getTime() - Date.now() < MIN_LEAD_MS) {
      setScheduleError("Pick a time at least a minute from now");
      return;
    }
    setScheduleError(null);
    setSubmitting(true);
    try {
      let mediaUrl: string | undefined;
      let messageType: "text" | "image" | "video" | "document" = "text";
      if (attachment) {
        const { file } = attachment;
        const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
        let uploaded = uploadedMediaRef.current;
        if (!uploaded || uploaded.fileKey !== fileKey) {
          const upload = await uploadMedia(file);
          uploaded = {
            fileKey,
            mediaUrl: upload.mediaUrl,
            mimeType: upload.mimeType,
          };
          uploadedMediaRef.current = uploaded;
        }
        mediaUrl = uploaded.mediaUrl;
        if (uploaded.mimeType.startsWith("image/")) messageType = "image";
        else if (uploaded.mimeType.startsWith("video/")) messageType = "video";
        else messageType = "document";
      }

      const job = await createMutation.mutateAsync({
        name: name.trim(),
        audience,
        content,
        messageType,
        mediaUrl,
        scheduledAt: parsed.toISOString(),
        audienceHash: preview.audienceHash,
        idempotencyKey: idempotencyKeyRef.current,
      });
      toast.success(
        `Broadcast scheduled for ${dayjs(parsed.toISOString()).format(
          "MMM D [at] HH:mm",
        )}`,
      );
      onCreated(job);
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.statusCode === 409 &&
        error.code === "audience_changed"
      ) {
        toast.error("The audience changed — review the new counts.");
        setStep("preview");
        void runPreview();
      } else {
        toast.error(
          error instanceof Error
            ? `Failed to schedule broadcast: ${error.message}`
            : "Failed to schedule broadcast. Please try again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && submitting) return;
    onOpenChange(nextOpen);
  };

  const AttachmentIcon = attachment ? attachmentIcon(attachment.file) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="mx-3 flex max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl border-[#d7e0da] p-0 shadow-2xl dark:border-dark-border sm:w-full">
        <DialogHeader className="border-b border-[#e3e9e5] bg-white px-5 py-4 pr-12 text-left dark:border-dark-border dark:bg-dark-elevated sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/60 dark:text-emerald-300">
              <Megaphone className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base">New broadcast</DialogTitle>
                <span className="rounded-full bg-[#edf2ef] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#65736d] dark:bg-dark-tertiary dark:text-dark-text-secondary">
                  Step {WIZARD_STEPS.findIndex((item) => item.id === step) + 1}{" "}
                  of {WIZARD_STEPS.length}
                </span>
              </div>
              <DialogDescription className="mt-0.5 truncate text-xs">
                Build the audience, message, and delivery plan before
                scheduling.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <BroadcastStepProgress currentStep={step} />

        <div className="flex-1 overflow-y-auto bg-[#f8faf8] px-4 py-5 dark:bg-dark-primary/45 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-3xl">
            <StepWizard
              steps={WIZARD_STEPS}
              currentStep={step}
              showProgress={false}
            >
              {/* Step 1 — Audience */}
              <StepContent stepId="audience" currentStep={step}>
                <div className="space-y-5">
                  <div className="border-b border-[#e3e9e5] pb-4 dark:border-dark-border">
                    <h3 className="text-sm font-semibold text-[#20362e] dark:text-dark-text-primary">
                      Choose who should receive this
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-[#718078] dark:text-dark-text-secondary">
                      Combine tags and individual contacts. Duplicates are
                      removed before scheduling.
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
                      Tags
                    </p>
                    <p className="mt-0.5 text-xs text-[#667781] dark:text-dark-text-tertiary">
                      Every contact carrying a selected tag is included.
                    </p>
                    <TagSearchInput
                      value={tagSearch}
                      onChange={setTagSearch}
                      className="mt-2 max-w-sm"
                    />
                    <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                      {tagsLoading ? (
                        <span className="text-sm text-[#667781] dark:text-dark-text-secondary">
                          Loading tags…
                        </span>
                      ) : !tags || tags.length === 0 ? (
                        <span className="text-sm text-[#667781] dark:text-dark-text-secondary">
                          {debouncedTagSearch
                            ? `No tags match “${debouncedTagSearch}”`
                            : "No tags yet — pick contacts below instead."}
                        </span>
                      ) : (
                        tags.map((tag) => {
                          const isSelected = selectedTagIds.includes(tag.id);
                          const isDisabled =
                            !isSelected &&
                            selectedTagIds.length >= MAX_AUDIENCE_TAGS;
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleTag(tag.id)}
                              aria-pressed={isSelected}
                              disabled={isDisabled}
                              title={
                                isDisabled
                                  ? `You can select up to ${MAX_AUDIENCE_TAGS} tags`
                                  : undefined
                              }
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/40 disabled:cursor-not-allowed disabled:opacity-45",
                                isSelected
                                  ? "border-[#00a884] bg-[#00a884]/10 text-[#008069] dark:border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  : "border-black/[0.08] text-[#54656f] hover:bg-[#f0f2f5] dark:border-white/[0.1] dark:text-dark-text-secondary dark:hover:bg-white/[0.06]",
                              )}
                            >
                              {isSelected && (
                                <Check className="size-3" aria-hidden="true" />
                              )}
                              {tag.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
                      Contacts
                    </p>
                    <p className="mt-0.5 mb-2 text-xs text-[#667781] dark:text-dark-text-tertiary">
                      Add individual contacts on top of any tags.
                    </p>
                    <ContactMultiSelect
                      selected={selectedContacts}
                      onToggle={toggleContact}
                    />
                  </div>

                  {activeConnections.length > 1 && (
                    <div>
                      <Label
                        htmlFor="broadcast-connection"
                        className="text-sm font-medium text-[#111b21] dark:text-dark-text-primary"
                      >
                        WhatsApp account
                      </Label>
                      <Select
                        value={connectionId}
                        onValueChange={setConnectionId}
                      >
                        <SelectTrigger
                          id="broadcast-connection"
                          className="mt-1.5 w-full sm:w-72"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All accounts</SelectItem>
                          {activeConnections.map((connection) => (
                            <SelectItem
                              key={connection.id}
                              value={connection.id}
                            >
                              {connection.name}
                              {connection.phoneNumber &&
                                ` (${connection.phoneNumber})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#cfe1d7] bg-[#edf6f1] px-3.5 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/30"
                    aria-live="polite"
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold text-[#52675f] dark:text-dark-text-secondary">
                      <UsersRound
                        className="h-4 w-4 text-[#0b7a55] dark:text-emerald-300"
                        aria-hidden="true"
                      />
                      Audience definition
                    </span>
                    <span className="text-xs font-bold tabular-nums text-[#087654] dark:text-emerald-300">
                      {selectedTagIds.length} tag
                      {selectedTagIds.length === 1 ? "" : "s"} ·{" "}
                      {selectedContacts.size} contact
                      {selectedContacts.size === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </StepContent>

              {/* Step 2 — Message */}
              <StepContent stepId="message" currentStep={step}>
                <div className="space-y-5">
                  <div className="border-b border-[#e3e9e5] pb-4 dark:border-dark-border">
                    <h3 className="text-sm font-semibold text-[#20362e] dark:text-dark-text-primary">
                      Compose the campaign
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-[#718078] dark:text-dark-text-secondary">
                      Give it an internal name, then write the message
                      recipients will see.
                    </p>
                  </div>
                  <div>
                    <Label
                      htmlFor="broadcast-name"
                      className="text-sm font-medium text-[#111b21] dark:text-dark-text-primary"
                    >
                      Broadcast name
                    </Label>
                    <Input
                      id="broadcast-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. April promotion"
                      className="mt-1.5"
                      maxLength={120}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="broadcast-content"
                        className="text-sm font-medium text-[#111b21] dark:text-dark-text-primary"
                      >
                        Message
                      </Label>
                      <span className="text-xs tabular-nums text-[#667781] dark:text-dark-text-tertiary">
                        {content.length} characters
                      </span>
                    </div>
                    <Textarea
                      id="broadcast-content"
                      ref={contentRef}
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                      placeholder="Hi {{firstName}}, …"
                      rows={6}
                      className="mt-1.5"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-[#667781] dark:text-dark-text-tertiary">
                        Insert:
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => insertToken("name")}
                      >
                        {"{{name}}"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => insertToken("firstName")}
                      >
                        {"{{firstName}}"}
                      </Button>
                    </div>
                    <p className="mt-1.5 text-xs text-[#667781] dark:text-dark-text-tertiary">
                      {"{{name}}"} becomes the contact's full name and{" "}
                      {"{{firstName}}"} their first name. Other tokens are not
                      supported.
                    </p>
                    {unknownTokens.length > 0 && (
                      <p
                        className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                        role="alert"
                      >
                        Unsupported token{unknownTokens.length === 1 ? "" : "s"}
                        :{" "}
                        {unknownTokens
                          .map((token) => `{{${token}}}`)
                          .join(", ")}
                        . Only {"{{name}}"} and {"{{firstName}}"} are allowed.
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
                      Attachment{" "}
                      <span className="font-normal text-[#667781] dark:text-dark-text-tertiary">
                        (optional, max 50MB)
                      </span>
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*,application/*,text/*"
                      onChange={handleFileSelect}
                      className="hidden"
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                    {attachment ? (
                      <div className="mt-2 flex items-center gap-3 rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.07]">
                        {attachment.previewUrl ? (
                          <img
                            src={attachment.previewUrl}
                            alt="Attachment preview"
                            className="size-16 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          AttachmentIcon && (
                            <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-[#00a884]/10 text-[#008069] dark:bg-emerald-900/30 dark:text-emerald-300">
                              <AttachmentIcon
                                className="size-6"
                                aria-hidden="true"
                              />
                            </span>
                          )
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
                            {attachment.file.name}
                          </p>
                          <p className="text-xs text-[#667781] dark:text-dark-text-tertiary">
                            {formatBytes(attachment.file.size)} · sent with
                            every message
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove attachment"
                          onClick={removeAttachment}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 gap-2"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip aria-hidden="true" />
                        Attach image, video, or file
                      </Button>
                    )}
                  </div>
                </div>
              </StepContent>

              {/* Step 3 — Preview */}
              <StepContent stepId="preview" currentStep={step}>
                {previewMutation.isPending ? (
                  <div className="flex flex-col items-center py-12">
                    <Loader2
                      className="size-6 animate-spin text-[#00a884]"
                      aria-hidden="true"
                    />
                    <p className="mt-3 text-sm text-[#667781] dark:text-dark-text-secondary">
                      Calculating audience…
                    </p>
                  </div>
                ) : previewError ? (
                  <div className="flex flex-col items-center rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center dark:border-red-800 dark:bg-red-900/20">
                    <AlertTriangle
                      className="size-6 text-red-500 dark:text-red-400"
                      aria-hidden="true"
                    />
                    <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                      {previewError}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 gap-2"
                      onClick={() => void runPreview()}
                    >
                      <RefreshCw aria-hidden="true" />
                      Retry
                    </Button>
                  </div>
                ) : preview ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-2xl font-semibold text-[#111b21] dark:text-dark-text-primary">
                          {preview.recipientCount} recipient
                          {preview.recipientCount === 1 ? "" : "s"}
                        </p>
                        <p className="mt-0.5 text-sm text-[#667781] dark:text-dark-text-secondary">
                          Estimated send time:{" "}
                          {humanizeDuration(preview.estimatedDurationSeconds)}{" "}
                          (one message every{" "}
                          {preview.limits.sendIntervalSeconds}
                          s)
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => void runPreview()}
                      >
                        <RefreshCw aria-hidden="true" />
                        Refresh
                      </Button>
                    </div>

                    {preview.recipientCount === 0 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                        No eligible recipients. Adjust the audience and try
                        again.
                      </div>
                    )}

                    {overMaxRecipients && (
                      <div
                        className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                        role="alert"
                      >
                        This audience exceeds the maximum of{" "}
                        {preview.limits.maxRecipientsPerJob} recipients per
                        broadcast. Narrow the audience to continue.
                      </div>
                    )}

                    {overDailyCap && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                        More than {preview.limits.dailyCapPerConnection}{" "}
                        recipients on one account — sending will span multiple
                        days to respect the daily cap.
                      </div>
                    )}

                    {preview.perConnection.length > 0 && (
                      <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.07]">
                        <p className="border-b border-black/[0.06] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#667781] dark:border-white/[0.07] dark:text-dark-text-tertiary">
                          By account
                        </p>
                        <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                          {preview.perConnection.map((connection) => (
                            <li
                              key={connection.connectionId}
                              className="flex items-center justify-between px-4 py-2.5 text-sm"
                            >
                              <span className="text-[#111b21] dark:text-dark-text-primary">
                                {connection.connectionName || "Unknown account"}
                              </span>
                              <span className="tabular-nums text-[#667781] dark:text-dark-text-secondary">
                                {connection.recipientCount}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {preview.skippedCount > 0 && (
                      <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.07]">
                        <p className="border-b border-black/[0.06] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#667781] dark:border-white/[0.07] dark:text-dark-text-tertiary">
                          {preview.skippedCount} skipped
                        </p>
                        <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                          {Object.entries(preview.skippedByReason).map(
                            ([reason, count]) => (
                              <li
                                key={reason}
                                className="flex items-center justify-between px-4 py-2.5 text-sm"
                              >
                                <span className="text-[#111b21] dark:text-dark-text-primary">
                                  {humanizeSkipReason(reason)}
                                </span>
                                <span className="tabular-nums text-[#667781] dark:text-dark-text-secondary">
                                  {count}
                                </span>
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}

                    {content.trim() && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-[#667781] dark:text-dark-text-tertiary">
                          Sample message
                        </p>
                        <div className="mt-2 max-w-md rounded-xl rounded-tl-sm bg-[#d9fdd3] p-3 text-sm text-[#111b21] shadow-sm dark:bg-emerald-900/40 dark:text-dark-text-primary">
                          <p className="whitespace-pre-wrap">
                            {personalizeSample(content, sampleName)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </StepContent>

              {/* Step 4 — Schedule & confirm */}
              <StepContent stepId="schedule" currentStep={step}>
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-medium text-[#111b21] dark:text-dark-text-primary">
                      When should sending start?
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {SCHEDULE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setScheduleValue(
                              toLocalInputValue(preset.value().second(0)),
                            );
                            setScheduleError(null);
                          }}
                          className="rounded-full border border-black/[0.08] px-2.5 py-1 text-xs font-medium text-[#54656f] transition-colors hover:bg-[#f0f2f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]/35 dark:border-white/[0.1] dark:text-dark-text-secondary dark:hover:bg-white/[0.06]"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <label className="mt-3 block max-w-xs">
                      <span className="text-xs font-medium text-[#667781] dark:text-dark-text-tertiary">
                        Send at (
                        {Intl.DateTimeFormat().resolvedOptions().timeZone})
                      </span>
                      <input
                        type="datetime-local"
                        value={scheduleValue}
                        min={toLocalInputValue(dayjs().add(1, "minute"))}
                        onChange={(event) => {
                          setScheduleValue(event.target.value);
                          setScheduleError(null);
                        }}
                        className="mt-1 block w-full rounded-lg border border-black/[0.1] bg-white px-2.5 py-1.5 text-sm text-[#111b21] outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884]/40 dark:border-white/[0.1] dark:bg-dark-tertiary dark:text-dark-text-primary"
                        aria-label="Broadcast start time"
                      />
                    </label>
                    {scheduleError && (
                      <p
                        className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                        role="alert"
                      >
                        {scheduleError}
                      </p>
                    )}
                  </div>

                  {preview && (
                    <p className="text-sm text-[#111b21] dark:text-dark-text-primary">
                      Send to{" "}
                      <span className="font-semibold">
                        {preview.recipientCount} contact
                        {preview.recipientCount === 1 ? "" : "s"}
                      </span>{" "}
                      starting{" "}
                      {formatScheduledTime(
                        new Date(scheduleValue).toISOString(),
                      )}
                      , ~{preview.limits.sendIntervalSeconds}s apart (
                      {humanizeDuration(preview.estimatedDurationSeconds)}{" "}
                      total).
                    </p>
                  )}

                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
                    <div className="flex gap-3">
                      <AlertTriangle
                        className="size-5 shrink-0 text-amber-600 dark:text-amber-400"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">
                          Bulk messaging can get your number banned
                        </p>
                        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300/90">
                          WhatsApp actively enforces against bulk and automated
                          messaging. Sends are paced and capped daily to reduce
                          the risk, but it is never zero. Only message people
                          who expect to hear from you.
                        </p>
                      </div>
                    </div>
                    <label
                      htmlFor="broadcast-risk"
                      className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm font-medium text-amber-900 dark:text-amber-300"
                    >
                      <Checkbox
                        id="broadcast-risk"
                        checked={riskAccepted}
                        onCheckedChange={(checked) =>
                          setRiskAccepted(checked === true)
                        }
                      />
                      I understand the risks
                    </label>
                  </div>
                </div>
              </StepContent>
            </StepWizard>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#d7e0da] bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-elevated sm:px-6">
          <div>
            {step !== "audience" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBack}
                disabled={submitting}
              >
                Back
              </Button>
            )}
          </div>
          {step === "schedule" ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!riskAccepted || submitting || !preview}
              className="gap-2 bg-[#0b7a55] text-white shadow-sm hover:bg-[#096747]"
            >
              {submitting && (
                <Loader2 className="animate-spin" aria-hidden="true" />
              )}
              Schedule broadcast
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleNext}
              className="bg-[#0b7a55] text-white shadow-sm hover:bg-[#096747]"
              disabled={
                (step === "audience" && audienceCount === 0) ||
                (step === "message" && !canLeaveMessageStep) ||
                (step === "preview" && !canLeavePreviewStep)
              }
            >
              Next
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
