import { useMutation } from "@tanstack/react-query";
import { forgotPassword } from "@/lib/api/auth";

/**
 * Hook for forgot password mutation
 * Sends a password reset email to the user
 */
export function useForgotPassword() {
  return useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      return forgotPassword(email);
    },
  });
}
