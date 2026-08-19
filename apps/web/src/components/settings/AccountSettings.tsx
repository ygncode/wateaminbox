import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { changeCurrentUserPassword } from "@/lib/api";
import {
  PROFILE_AVATAR_INPUT_BYTES,
  PROFILE_AVATAR_SIZE,
  prepareProfileAvatar,
  validateProfileAvatar,
} from "@/lib/profile-avatar";
import {
  type ChangePasswordSettingsFormData,
  changePasswordSettingsSchema,
  type ProfileSettingsFormData,
  profileSettingsSchema,
} from "@/lib/schemas/auth";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { useTranslation } from "react-i18next";

function initials(name: string, email: string): string {
  const value = name.trim() || email;
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function AccountSettings() {
  const { t } = useTranslation();

  const { user, updateProfile } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const profileForm = useForm<ProfileSettingsFormData>({
    resolver: zodResolver(profileSettingsSchema),
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      currentPassword: "",
    },
  });
  const passwordForm = useForm<ChangePasswordSettingsFormData>({
    resolver: zodResolver(changePasswordSettingsSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  if (!user) return null;

  const watchedEmail = profileForm.watch("email");
  const emailChanged =
    watchedEmail.trim().toLowerCase() !== user.email.toLowerCase();
  const avatarPreview =
    avatarDataUrl ??
    (avatarRemoved ? user.gravatarUrl : user.avatarUrl) ??
    user.gravatarUrl;
  const hasAvatarChange = avatarDataUrl !== null || avatarRemoved;

  const handleAvatar = async (file?: File) => {
    if (!file) return;
    const validationError = validateProfileAvatar(file);
    if (validationError) {
      setAvatarError(validationError);
      return;
    }

    setAvatarError(null);
    setIsProcessingAvatar(true);
    try {
      setAvatarDataUrl(await prepareProfileAvatar(file));
      setAvatarRemoved(false);
    } catch (error) {
      setAvatarError(
        error instanceof Error
          ? error.message
          : t("account.imageProcessFailed", "Could not process this image"),
      );
    } finally {
      setIsProcessingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const saveProfile = async (data: ProfileSettingsFormData) => {
    const name = data.name.trim();
    const email = data.email.trim().toLowerCase();
    if (emailChanged && !data.currentPassword) {
      profileForm.setError("currentPassword", {
        message: t(
          "account.currentPasswordRequired",
          "Enter your current password to change your email",
        ),
      });
      return;
    }

    const nameChanged = name !== user.name;
    if (!nameChanged && !emailChanged && !hasAvatarChange) {
      toast.info(
        t("account.alreadyUpToDate", "Your profile is already up to date"),
      );
      return;
    }

    setIsSavingProfile(true);
    try {
      const response = await updateProfile({
        ...(nameChanged ? { name } : {}),
        ...(emailChanged
          ? { email, currentPassword: data.currentPassword }
          : {}),
        ...(avatarDataUrl
          ? { avatarDataUrl }
          : avatarRemoved
            ? { avatarDataUrl: null }
            : {}),
      });
      profileForm.reset({
        name: response.user.name ?? response.user.email.split("@")[0],
        email: response.user.email,
        currentPassword: "",
      });
      setAvatarDataUrl(null);
      setAvatarRemoved(false);
      setAvatarError(null);
      if (response.emailVerificationRequired) {
        if (response.emailVerificationSent) {
          toast.success(
            t(
              "account.emailChangedVerify",
              "Email changed. Verify the new address before signing in again.",
            ),
          );
        } else {
          toast.warning(
            t(
              "account.emailChangedNoVerification",
              "Email changed, but the verification message could not be sent. Sign in to retry.",
            ),
          );
        }
      } else {
        toast.success(t("account.profileSaved", "Profile saved"));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("account.profileSaveFailed", "Could not save your profile"),
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const savePassword = async (data: ChangePasswordSettingsFormData) => {
    setIsChangingPassword(true);
    try {
      await changeCurrentUserPassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      passwordForm.reset();
      toast.success(
        t(
          "account.passwordChanged",
          "Password changed. Other device sessions were signed out.",
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("account.passwordChangeFailed", "Could not change password"),
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  const profileBusy = isSavingProfile || isProcessingAvatar;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6">
        <h3 className="font-semibold">{t("account.profile", "Profile")}</h3>
        <p className="mt-1 text-sm leading-6 text-[#65736d] dark:text-dark-text-secondary">
          {t(
            "account.profileDescription",
            "Choose how your name and image appear to teammates.",
          )}
        </p>

        <div className="mt-6 flex flex-col gap-5 border-b border-[#e4e9e5] pb-6 sm:flex-row sm:items-center dark:border-dark-border">
          <Avatar className="h-24 w-24 rounded-2xl border border-[#dce3de] bg-[#edf1ed] shadow-sm dark:border-dark-border">
            <AvatarImage
              src={avatarPreview}
              alt={t("account.avatarAlt", {
                defaultValue: "{{name}}'s profile",
                name: user.name,
              })}
              className="object-cover"
              width={96}
              height={96}
            />
            <AvatarFallback className="rounded-2xl text-lg font-semibold">
              {initials(user.name, user.email)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <input
              ref={avatarInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif,.avif,image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void handleAvatar(event.target.files?.[0])}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => avatarInputRef.current?.click()}
                disabled={profileBusy}
                className="rounded-xl"
              >
                {isProcessingAvatar ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Upload aria-hidden="true" />
                )}
                {t("account.uploadImage", "Upload image")}
              </Button>
              {(user.hasCustomAvatar || avatarDataUrl) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAvatarDataUrl(null);
                    setAvatarRemoved(true);
                    setAvatarError(null);
                  }}
                  disabled={profileBusy}
                  className="rounded-xl text-[#65736d]"
                >
                  <ImagePlus aria-hidden="true" />
                  {t("account.useGravatar", "Use Gravatar")}
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs leading-5 text-[#65736d] dark:text-dark-text-secondary">
              {t("account.avatarHint", {
                defaultValue:
                  "Gravatar is used from your email by default. Custom images can be up to {{mb}} MB, must be at least 128 × 128, and are automatically cropped to {{size}} × {{size}}.",
                mb: PROFILE_AVATAR_INPUT_BYTES / 1024 / 1024,
                size: PROFILE_AVATAR_SIZE,
              })}
            </p>
            {avatarError && (
              <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                {avatarError}
              </p>
            )}
          </div>
        </div>

        <form
          onSubmit={profileForm.handleSubmit(saveProfile)}
          className="mt-6 space-y-5 [&_input]:h-11 [&_input]:rounded-xl"
          noValidate
        >
          <fieldset disabled={profileBusy} className="space-y-5">
            <FormField
              label={t("account.fullName", "Full name")}
              id="profile-name"
              placeholder={t("account.fullNamePlaceholder", "Your full name")}
              registration={profileForm.register("name")}
              error={profileForm.formState.errors.name}
              autoComplete="name"
            />
            <FormField
              label={t("account.emailAddress", "Email address")}
              id="profile-email"
              type="email"
              placeholder="you@company.com"
              registration={profileForm.register("email")}
              error={profileForm.formState.errors.email}
              autoComplete="email"
              hint={
                emailChanged
                  ? t(
                      "account.emailChangeHint",
                      "We’ll send a verification link to the new address.",
                    )
                  : t(
                      "account.gravatarHint",
                      "Your Gravatar is matched using this email.",
                    )
              }
            />
            {emailChanged && (
              <FormField
                label={t("account.currentPassword", "Current password")}
                id="profile-current-password"
                type="password"
                placeholder={t(
                  "account.confirmEmailChange",
                  "Confirm this email change",
                )}
                registration={profileForm.register("currentPassword")}
                error={profileForm.formState.errors.currentPassword}
                autoComplete="current-password"
                showPasswordToggle
              />
            )}
          </fieldset>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={profileBusy}
              className="rounded-xl bg-[#075e54] text-white hover:bg-[#064b43]"
            >
              {isSavingProfile ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Save aria-hidden="true" />
              )}
              {isSavingProfile
                ? t("common.saving", "Saving…")
                : t("account.saveProfile", "Save profile")}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e2f4e9] text-[#075e54] dark:bg-emerald-400/10 dark:text-emerald-300">
            <KeyRound aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold">
              {t("account.password", "Password")}
            </h3>
            <p className="mt-1 text-sm leading-6 text-[#65736d] dark:text-dark-text-secondary">
              {t(
                "account.passwordDescription",
                "Updating your password keeps this session active and signs out your other devices.",
              )}
            </p>
          </div>
        </div>

        <form
          onSubmit={passwordForm.handleSubmit(savePassword)}
          className="mt-6 space-y-5 [&_input]:h-11 [&_input]:rounded-xl"
          noValidate
        >
          <fieldset disabled={isChangingPassword} className="space-y-5">
            <FormField
              label={t("account.currentPassword", "Current password")}
              id="password-current"
              type="password"
              placeholder={t(
                "account.currentPasswordPlaceholder",
                "Enter your current password",
              )}
              registration={passwordForm.register("currentPassword")}
              error={passwordForm.formState.errors.currentPassword}
              autoComplete="current-password"
              showPasswordToggle
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                label={t("account.newPassword", "New password")}
                id="password-new"
                type="password"
                placeholder={t(
                  "account.newPasswordPlaceholder",
                  "Choose a strong password",
                )}
                registration={passwordForm.register("newPassword")}
                error={passwordForm.formState.errors.newPassword}
                autoComplete="new-password"
                showPasswordToggle
                hint={t(
                  "account.passwordRules",
                  "8–128 characters with upper, lower, and a number.",
                )}
              />
              <FormField
                label={t("account.confirmNewPassword", "Confirm new password")}
                id="password-confirm"
                type="password"
                placeholder={t(
                  "account.confirmNewPasswordPlaceholder",
                  "Repeat the new password",
                )}
                registration={passwordForm.register("confirmPassword")}
                error={passwordForm.formState.errors.confirmPassword}
                autoComplete="new-password"
                showPasswordToggle
              />
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 border-t border-[#e4e9e5] pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-dark-border">
            <p className="flex items-center gap-2 text-xs text-[#65736d] dark:text-dark-text-secondary">
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
              {t(
                "account.deviceStaysSignedIn",
                "Your current device stays signed in.",
              )}
            </p>
            <Button
              type="submit"
              disabled={isChangingPassword}
              className="rounded-xl bg-[#075e54] text-white hover:bg-[#064b43]"
            >
              {isChangingPassword ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              {isChangingPassword
                ? t("common.updating", "Updating…")
                : t("account.changePassword", "Change password")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
