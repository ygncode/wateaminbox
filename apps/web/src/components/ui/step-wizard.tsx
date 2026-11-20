import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface StepWizardStep {
  id: string;
  /** Optional i18n key; `label` is the English fallback. */
  labelKey?: string;
  label: string;
  description?: string;
}

interface StepProgressProps {
  steps: StepWizardStep[];
  currentStepIndex: number;
  className?: string;
}

export function StepProgress({
  steps,
  currentStepIndex,
  className = "",
}: StepProgressProps) {
  const { t } = useTranslation();

  return (
    <div className={`flex items-center justify-center ${className}`}>
      {steps.map((step, index) => {
        const isCompleted = index < currentStepIndex;
        const isCurrent = index === currentStepIndex;
        const isLast = index === steps.length - 1;

        return (
          <div key={step.id} className="flex items-center">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors ${
                  isCompleted
                    ? "bg-primary border-accent"
                    : isCurrent
                      ? "border-info bg-info"
                      : "border-line-strong bg-surface"
                }`}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4 text-white" />
                ) : (
                  <span
                    className={`text-sm font-medium ${
                      isCurrent ? "text-white" : "text-fg-muted"
                    }`}
                  >
                    {index + 1}
                  </span>
                )}
              </div>
              <span
                className={`mt-1 text-xs whitespace-nowrap ${
                  isCompleted || isCurrent
                    ? "text-fg font-medium"
                    : "text-fg-muted"
                }`}
              >
                {step.labelKey ? t(step.labelKey, step.label) : step.label}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                className={`w-12 h-0.5 mx-2 ${
                  isCompleted ? "bg-primary" : "bg-fg-subtle"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface StepWizardProps {
  steps: StepWizardStep[];
  currentStep: string;
  children: React.ReactNode;
  showProgress?: boolean;
  className?: string;
}

export function StepWizard({
  steps,
  currentStep,
  children,
  showProgress = true,
  className = "",
}: StepWizardProps) {
  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className={className}>
      {showProgress && steps.length > 1 && (
        <StepProgress
          steps={steps}
          currentStepIndex={currentStepIndex}
          className="mb-6"
        />
      )}
      {children}
    </div>
  );
}

interface StepContentProps {
  stepId: string;
  currentStep: string;
  children: React.ReactNode;
  className?: string;
}

export function StepContent({
  stepId,
  currentStep,
  children,
  className = "",
}: StepContentProps) {
  if (stepId !== currentStep) return null;
  return <div className={className}>{children}</div>;
}
