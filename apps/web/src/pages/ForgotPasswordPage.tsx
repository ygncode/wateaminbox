import * as React from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import {
  forgotPasswordSchema,
  type ForgotPasswordFormData,
} from "../lib/schemas";
import { forgotPassword } from "../lib/api";

export function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSubmitted, setIsSubmitted] = React.useState(false);
  const [submittedEmail, setSubmittedEmail] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setServerError(null);
    setIsLoading(true);

    try {
      await forgotPassword(data.email);
      setSubmittedEmail(data.email);
      setIsSubmitted(true);
    } catch {
      // Backend always returns success to prevent email enumeration
      // but we show success anyway for the same reason
      setSubmittedEmail(data.email);
      setIsSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
        <div className="w-full max-w-md">
          <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#25D366] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
                Check your email
              </h1>
              <p className="text-gray-600 dark:text-dark-text-secondary mt-2">
                We've sent a password reset link to{" "}
                <span className="font-medium">{submittedEmail}</span>
              </p>
              <p className="text-sm text-gray-500 dark:text-dark-text-tertiary mt-4">
                Didn't receive the email? Check your spam folder or{" "}
                <button
                  onClick={() => setIsSubmitted(false)}
                  className="text-whatsapp-green-a11y-text dark:text-whatsapp-green hover:text-whatsapp-green-a11y-button dark:hover:text-whatsapp-green/80"
                >
                  try again
                </button>
              </p>
              <Link
                to="/login"
                className="inline-block mt-6 text-whatsapp-green-a11y-text dark:text-whatsapp-green hover:text-whatsapp-green-a11y-button dark:hover:text-whatsapp-green/80 font-medium"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[#25D366] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
              Forgot password?
            </h1>
            <p className="text-gray-600 dark:text-dark-text-secondary mt-2">
              No worries, we'll send you reset instructions.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {serverError && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
                {serverError}
              </div>
            )}

            <FormField
              label="Email"
              id="email"
              type="email"
              placeholder="you@example.com"
              registration={register("email")}
              error={errors.email}
              autoComplete="email"
            />

            <Button
              type="submit"
              className="w-full bg-whatsapp-green-a11y-button hover:bg-whatsapp-green-a11y-button/90 dark:bg-whatsapp-green-a11y-button dark:hover:bg-whatsapp-green-a11y-button/90 text-white"
              disabled={isLoading}
            >
              {isLoading ? "Sending…" : "Reset password"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-whatsapp-green-a11y-text dark:text-whatsapp-green hover:text-whatsapp-green-a11y-button dark:hover:text-whatsapp-green/80 font-medium"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
