import { Check } from 'lucide-react'

export interface StepWizardStep {
  id: string
  label: string
  description?: string
}

interface StepProgressProps {
  steps: StepWizardStep[]
  currentStepIndex: number
  className?: string
}

export function StepProgress({ steps, currentStepIndex, className = '' }: StepProgressProps) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      {steps.map((step, index) => {
        const isCompleted = index < currentStepIndex
        const isCurrent = index === currentStepIndex
        const isLast = index === steps.length - 1

        return (
          <div key={step.id} className="flex items-center">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors ${
                  isCompleted
                    ? 'bg-green-500 border-green-500 dark:bg-green-600 dark:border-green-600'
                    : isCurrent
                      ? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400'
                      : 'border-gray-300 dark:border-dark-border bg-white dark:bg-dark-tertiary'
                }`}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4 text-white" />
                ) : (
                  <span
                    className={`text-sm font-medium ${
                      isCurrent ? 'text-white' : 'text-gray-500 dark:text-dark-text-secondary'
                    }`}
                  >
                    {index + 1}
                  </span>
                )}
              </div>
              <span
                className={`mt-1 text-xs whitespace-nowrap ${
                  isCompleted || isCurrent
                    ? 'text-gray-900 dark:text-dark-text-primary font-medium'
                    : 'text-gray-500 dark:text-dark-text-secondary'
                }`}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                className={`w-12 h-0.5 mx-2 ${
                  isCompleted ? 'bg-green-500 dark:bg-green-600' : 'bg-gray-300 dark:bg-dark-border'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

interface StepWizardProps {
  steps: StepWizardStep[]
  currentStep: string
  children: React.ReactNode
  showProgress?: boolean
  className?: string
}

export function StepWizard({
  steps,
  currentStep,
  children,
  showProgress = true,
  className = '',
}: StepWizardProps) {
  const currentStepIndex = steps.findIndex((s) => s.id === currentStep)

  return (
    <div className={className}>
      {showProgress && steps.length > 1 && (
        <StepProgress steps={steps} currentStepIndex={currentStepIndex} className="mb-6" />
      )}
      {children}
    </div>
  )
}

interface StepContentProps {
  stepId: string
  currentStep: string
  children: React.ReactNode
  className?: string
}

export function StepContent({ stepId, currentStep, children, className = '' }: StepContentProps) {
  if (stepId !== currentStep) return null
  return <div className={className}>{children}</div>
}
