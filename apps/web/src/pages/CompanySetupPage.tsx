import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { useCreateCompany } from "../hooks/useTeam";
import {
  type CompanySetupFormData,
  companySetupSchema,
} from "../lib/schemas/auth";
import { workspacePath } from "../lib/workspace-routes";

export function CompanySetupPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { refreshWorkspaces, switchWorkspace } = useWorkspace();
  const createCompany = useCreateCompany();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CompanySetupFormData>({
    resolver: zodResolver(companySetupSchema),
    defaultValues: {
      name: "",
    },
  });

  const onSubmit = async (data: CompanySetupFormData) => {
    createCompany.mutate(
      { name: data.name.trim() },
      {
        onSuccess: async (created) => {
          await refreshWorkspaces();
          await switchWorkspace(created.id);
          navigate(workspacePath(created.id), { replace: true });
        },
      },
    );
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
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
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary text-balance">
              Create Your Workspace
            </h1>
            <p className="text-gray-600 dark:text-dark-text-secondary mt-2">
              Set up your workspace to start using the app
            </p>
          </div>

          {createCompany.error && (
            <div
              role="alert"
              className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-800 text-red-700 dark:text-red-400 rounded"
            >
              {createCompany.error instanceof Error
                ? createCompany.error.message
                : "Failed to create workspace"}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label
                htmlFor="companyName"
                className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1"
              >
                Workspace Name
              </label>
              <input
                id="companyName"
                type="text"
                placeholder="Enter your company name…"
                spellCheck={false}
                autoComplete="organization"
                className="w-full px-4 py-2 border border-gray-300 dark:border-dark-border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary"
                disabled={createCompany.isPending}
                aria-invalid={errors.name ? "true" : "false"}
                aria-describedby={errors.name ? "companyName-error" : undefined}
                {...register("name")}
              />
              {errors.name && (
                <p
                  id="companyName-error"
                  className="mt-1 text-xs text-red-500 dark:text-red-400"
                  role="alert"
                >
                  {errors.name.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={createCompany.isPending}
              className="w-full bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createCompany.isPending ? "Creating…" : "Create Workspace"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={logout}
              className="text-sm text-gray-500 dark:text-dark-text-tertiary hover:text-gray-700 dark:hover:text-dark-text-secondary"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
