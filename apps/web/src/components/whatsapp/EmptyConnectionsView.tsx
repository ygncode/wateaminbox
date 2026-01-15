import { Loader2, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyConnectionsViewProps {
  onAdd: () => void;
  isCreating: boolean;
}

/**
 * Empty Connections View
 * Displayed when no WhatsApp connections exist
 */
export function EmptyConnectionsView({
  onAdd,
  isCreating,
}: EmptyConnectionsViewProps) {
  return (
    <div className="relative py-12 px-4 dark:bg-dark-elevated rounded-lg">
      <div className="relative text-center">
        {/* Animated illustration */}
        <div className="relative w-28 h-28 mx-auto mb-6">
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-whatsapp-teal-green/20 animate-[spin_20s_linear_infinite]" />

          {/* Inner circle */}
          <div className="absolute inset-2 rounded-full bg-whatsapp-teal-green/10" />

          {/* Icon container */}
          <div className="absolute inset-4 rounded-full bg-whatsapp-teal-green flex items-center justify-center shadow-xl">
            <MessageCircle className="h-10 w-10 text-white" />
          </div>

          {/* Floating accent dots */}
          <div className="absolute -top-1 left-1/2 w-2 h-2 rounded-full bg-whatsapp-teal-green/60 animate-pulse" />
          <div
            className="absolute top-1/4 -right-1 w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-pulse"
            style={{ animationDelay: "0.5s" }}
          />
          <div
            className="absolute -bottom-1 left-1/3 w-1.5 h-1.5 rounded-full bg-teal-400/60 animate-pulse"
            style={{ animationDelay: "1s" }}
          />
        </div>

        {/* Content */}
        <h3 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary mb-2 text-balance">
          No WhatsApp Connections Yet
        </h3>
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary mb-8 max-w-xs mx-auto leading-relaxed text-pretty">
          Connect your first WhatsApp device to start managing conversations
          with your team.
        </p>

        {/* CTA Button */}
        <Button
          onClick={onAdd}
          disabled={isCreating}
          size="lg"
          className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green text-white shadow-xl transition-all duration-300 px-8"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Creating Connection...
            </>
          ) : (
            <>
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Connection
            </>
          )}
        </Button>

        {/* Helper text */}
        <p className="text-xs text-gray-400 dark:text-dark-text-tertiary mt-4">
          You'll need your phone nearby to scan the QR code
        </p>
      </div>
    </div>
  );
}
