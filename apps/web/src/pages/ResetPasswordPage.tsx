import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, KeyRound } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { resetPassword } from "../lib/api";
import {
  resetPasswordSchema,
  type ResetPasswordFormData,
} from "../lib/schemas/auth";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [status, setStatus] = useState<"form" | "saving" | "success">("form");
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) return;
    setStatus("saving");
    setServerError(null);
    try {
      await resetPassword(token, data.password);
      setStatus("success");
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Unable to reset password",
      );
      setStatus("form");
    }
  };

  return (
    <main className="min-h-dvh grid place-items-center bg-gray-100 dark:bg-dark-primary px-4">
      <section className="w-full max-w-md rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-8 shadow-xl">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-whatsapp-green text-white shadow-lg shadow-green-500/20">
          {status === "success" ? (
            <CheckCircle2 size={32} />
          ) : (
            <KeyRound size={30} />
          )}
        </div>

        {status === "success" ? (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
              Password updated
            </h1>
            <p className="mt-3 text-gray-600 dark:text-dark-text-secondary">
              Every previous session has been signed out. You can now continue
              with your new password.
            </p>
            <Button
              asChild
              className="mt-7 w-full bg-whatsapp-green-a11y-button text-white"
            >
              <Link to="/login">Return to sign in</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-7 text-center">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
                Choose a new password
              </h1>
              <p className="mt-2 text-gray-600 dark:text-dark-text-secondary">
                Use at least eight characters. This link can only be used once.
              </p>
            </div>

            {!token && (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
              >
                This reset link is incomplete. Request a new one to continue.
              </div>
            )}
            {serverError && (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
              >
                {serverError}
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <FormField
                label="New password"
                id="password"
                type="password"
                registration={register("password")}
                error={errors.password}
                autoComplete="new-password"
                showPasswordToggle
              />
              <FormField
                label="Confirm password"
                id="confirmPassword"
                type="password"
                registration={register("confirmPassword")}
                error={errors.confirmPassword}
                autoComplete="new-password"
                showPasswordToggle
              />
              <Button
                type="submit"
                className="w-full bg-whatsapp-green-a11y-button text-white hover:bg-whatsapp-green-a11y-button/90"
                disabled={!token || status === "saving"}
              >
                {status === "saving" ? "Updating…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
