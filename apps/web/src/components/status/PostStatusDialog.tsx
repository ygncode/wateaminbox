import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Textarea,
  Label,
} from "@/components/ui";
import {
  Circle,
  Loader2,
  AlertCircle,
  Check,
  Type,
  Image,
  Video,
} from "lucide-react";
import { usePostStatus, type StatusType } from "@/hooks/useStatus";

export interface PostStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_TYPES: {
  value: StatusType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "text", label: "Text", icon: <Type className="h-4 w-4" /> },
  { value: "image", label: "Image", icon: <Image className="h-4 w-4" /> },
  { value: "video", label: "Video", icon: <Video className="h-4 w-4" /> },
];

/**
 * Dialog component for posting a new WhatsApp status update
 */
export function PostStatusDialog({
  open,
  onOpenChange,
}: PostStatusDialogProps) {
  const [statusType, setStatusType] = useState<StatusType>("text");
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const postStatus = usePostStatus();

  const resetForm = () => {
    setStatusType("text");
    setContent("");
    setMediaUrl("");
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    if (statusType === "text" && !content.trim()) {
      setError("Please enter some text for your status");
      return;
    }

    if (
      (statusType === "image" || statusType === "video") &&
      !mediaUrl.trim()
    ) {
      setError(`Please provide a URL for your ${statusType}`);
      return;
    }

    try {
      await postStatus.mutateAsync({
        type: statusType,
        content: content.trim() || undefined,
        mediaUrl: mediaUrl.trim() || undefined,
      });

      setSuccess(true);

      // Close dialog after a short delay
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to post status");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Circle className="h-5 w-5 text-whatsapp-teal-green" />
            Post Status Update
          </DialogTitle>
          <DialogDescription>
            Share a status update with your WhatsApp contacts. Status updates
            expire after 24 hours.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-lg font-medium text-gray-900">Status Posted!</p>
            <p className="text-sm text-gray-500 mt-1">
              Your status will be visible for 24 hours
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Status Type Selector */}
            <div className="space-y-2">
              <Label>Status Type</Label>
              <div className="flex gap-2">
                {STATUS_TYPES.map((type) => (
                  <Button
                    key={type.value}
                    type="button"
                    variant={statusType === type.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusType(type.value)}
                    className={
                      statusType === type.value
                        ? "bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
                        : ""
                    }
                    data-testid={`status-type-${type.value}`}
                  >
                    {type.icon}
                    <span className="ml-1">{type.label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Text Status Input */}
            {statusType === "text" && (
              <div className="space-y-2">
                <Label htmlFor="statusContent">
                  Status Text <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="statusContent"
                  placeholder="What's on your mind?"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={4}
                  maxLength={700}
                  autoFocus
                  data-testid="status-content"
                />
                <p className="text-xs text-gray-500 text-right">
                  {content.length}/700 characters
                </p>
              </div>
            )}

            {/* Media Status Input */}
            {(statusType === "image" || statusType === "video") && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="mediaUrl">
                    {statusType === "image" ? "Image" : "Video"} URL{" "}
                    <span className="text-red-500">*</span>
                  </Label>
                  <input
                    type="url"
                    id="mediaUrl"
                    placeholder={`https://example.com/${statusType}.${statusType === "image" ? "jpg" : "mp4"}`}
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="status-media-url"
                  />
                  <p className="text-xs text-gray-500">
                    Enter the URL of the {statusType} you want to share
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mediaCaption">Caption (Optional)</Label>
                  <Textarea
                    id="mediaCaption"
                    placeholder="Add a caption..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={2}
                    maxLength={700}
                    data-testid="status-caption"
                  />
                </div>
              </>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={postStatus.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  postStatus.isPending ||
                  (statusType === "text" && !content.trim()) ||
                  ((statusType === "image" || statusType === "video") &&
                    !mediaUrl.trim())
                }
                className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
                data-testid="post-status-submit"
              >
                {postStatus.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Posting...
                  </>
                ) : (
                  "Post Status"
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PostStatusDialog;
