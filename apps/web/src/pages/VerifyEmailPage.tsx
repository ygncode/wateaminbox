import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  MailCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Button } from "../components/ui/button";
import { verifyEmail } from "../lib/api";
import { buildAuthUrl } from "../lib/auth-redirect";
import { workspacePath } from "../lib/workspace-routes";

type VerificationState = "loading" | "success" | "error";

export function VerifyEmailPage() {
  const { t } = useTranslation();

  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const invitationToken = searchParams.get("invitation") || undefined;
  const started = useRef(false);
  const [state, setState] = useState<VerificationState>("loading");
  const [message, setMessage] = useState("Verifying your email address…");
  const [loginUrl, setLoginUrl] = useState("/login");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState("error");
      setMessage("This verification link is incomplete.");
      return;
    }

    verifyEmail(token, invitationToken)
      .then((result) => {
        setState("success");
        if (result.invitationAccepted && result.companyId) {
          setMessage(
            t(
              "verify.joinedWorkspace",
              "Your email is verified and you've joined the workspace. Sign in to continue.",
            ),
          );
          setLoginUrl(
            buildAuthUrl(
              "/login",
              workspacePath(result.companyId),
              result.user.email,
            ),
          );
          return;
        }
        setMessage(
          invitationToken
            ? t(
                "verify.invitationUnavailable",
                "Your email is verified. The invitation is no longer available, but you can still sign in.",
              )
            : t(
                "verify.verificationComplete",
                "Your email is verified. Your workspace is ready when you are.",
              ),
        );
        setLoginUrl(buildAuthUrl("/login", null, result.user.email));
      })
      .catch((error) => {
        setState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : t(
                "verify.invalidLink",
                "This verification link is invalid or has expired.",
              ),
        );
      });
  }, [invitationToken, t, token]);

  const Icon =
    state === "loading"
      ? LoaderCircle
      : state === "success"
        ? CheckCircle2
        : AlertCircle;

  return (
    <main className="min-h-dvh grid place-items-center bg-gray-100 dark:bg-dark-primary px-4">
      <section className="relative w-full max-w-md overflow-hidden rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-8 text-center shadow-xl">
        <div className="absolute inset-x-0 top-0 h-1 bg-whatsapp-green" />
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-whatsapp-green/10 text-whatsapp-green">
          {state === "loading" ? (
            <Icon className="animate-spin" size={32} />
          ) : (
            <Icon size={34} />
          )}
        </div>
        <MailCheck
          className="mx-auto mb-2 text-gray-300 dark:text-dark-text-tertiary"
          size={20}
        />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
          {state === "loading"
            ? t("verify.oneMoment", "One moment")
            : state === "success"
              ? t("verify.emailVerified", "Email verified")
              : t("verify.linkUnavailable", "Link unavailable")}
        </h1>
        <p className="mt-3 text-gray-600 dark:text-dark-text-secondary">
          {message}
        </p>

        {state !== "loading" && (
          <Button
            asChild
            className="mt-7 w-full bg-whatsapp-green-a11y-button text-white"
          >
            <Link to={state === "success" ? loginUrl : "/register"}>
              {state === "success"
                ? t("auth.continueToSignIn", "Continue to sign in")
                : t("verify.backToRegistration", "Back to registration")}
            </Link>
          </Button>
        )}
      </section>
    </main>
  );
}
