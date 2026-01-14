import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useAuth } from "../contexts/auth-context";
import { type LoginFormData, loginSchema } from "../lib/schemas";

export function LoginPage() {
  const navigate = useNavigate();
  const {
    login,
    isLoading,
    error,
    clearError,
    isAuthenticated,
    needsCompanySetup,
  } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // Redirect authenticated users to the appropriate page
  React.useEffect(() => {
    if (isAuthenticated) {
      if (needsCompanySetup) {
        navigate("/company-setup");
      } else {
        navigate("/chat");
      }
    }
  }, [isAuthenticated, needsCompanySetup, navigate]);

  const onSubmit = async (data: LoginFormData) => {
    clearError();
    try {
      await login(data.email, data.password);
      // Navigation is handled by useEffect based on auth state
    } catch {
      // Error is handled by auth context
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[#25D366] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-10 h-10 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
              Welcome back
            </h1>
            <p className="text-gray-600 dark:text-dark-text-secondary mt-2">
              Sign in to WhatsApp Web
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div
                role="alert"
                className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm"
              >
                {error}
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

            <FormField
              label="Password"
              id="password"
              type="password"
              placeholder="Enter your password"
              registration={register("password")}
              error={errors.password}
              autoComplete="current-password"
            />

            <div className="flex items-center justify-between">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 text-whatsapp-green-a11y-button border-gray-300 dark:border-dark-border dark:bg-dark-elevated rounded focus:ring-whatsapp-green-a11y-button"
                />
                <span className="ml-2 text-sm text-gray-600 dark:text-dark-text-secondary">
                  Remember me
                </span>
              </label>
              <Link
                to="/forgot-password"
                className="text-sm text-whatsapp-green-a11y-text dark:text-whatsapp-green hover:text-whatsapp-green-a11y-button dark:hover:text-whatsapp-green/80"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              className="w-full bg-whatsapp-green-a11y-button hover:bg-whatsapp-green-a11y-button/90 dark:bg-whatsapp-green-a11y-button dark:hover:bg-whatsapp-green-a11y-button/90 text-white"
              disabled={isLoading}
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
              Don't have an account?{" "}
              <Link
                to="/register"
                className="text-whatsapp-green-a11y-text dark:text-whatsapp-green hover:text-whatsapp-green-a11y-button dark:hover:text-whatsapp-green/80 font-medium"
              >
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
