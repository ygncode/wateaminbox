import { Check } from "lucide-react";
import { formatPhoneNumber } from "@/lib/utils";
import type { CompleteStepProps } from "./types";
import { useTranslation } from "react-i18next";

export function CompleteStep({ result }: CompleteStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Result summary */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-soft rounded-full mb-4">
          <Check className="h-8 w-8 text-accent" />
        </div>
        <h3 className="text-xl font-semibold text-fg">
          {t("contacts.importComplete", "Import Complete")}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-accent-soft rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-accent">
            {result.summary.created}
          </div>
          <div className="text-sm text-accent">
            {t("contacts.createdCount")}
          </div>
        </div>
        <div className="bg-info-soft rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-info">
            {result.summary.updated}
          </div>
          <div className="text-sm text-info">{t("contacts.updatedCount")}</div>
        </div>
        <div className="bg-subtle rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-fg-muted">
            {result.summary.skipped}
          </div>
          <div className="text-sm text-fg-muted">
            {t("contacts.skippedCount")}
          </div>
        </div>
        <div className="bg-danger-soft rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-danger">
            {result.summary.errors}
          </div>
          <div className="text-sm text-danger">
            {t("contacts.errorsLabel", "Errors")}
          </div>
        </div>
      </div>

      {/* Error details */}
      {result.summary.errors > 0 && (
        <div className="border border-danger/30 rounded-lg overflow-hidden">
          <div className="bg-danger-soft px-4 py-2 font-medium text-danger">
            {t("contacts.errorsCount", { count: result.summary.errors })}
          </div>
          <div className="max-h-40 overflow-y-auto">
            {result.results
              .filter((r) => r.status === "error")
              .map((r) => (
                <div
                  key={r.row}
                  className="px-4 py-2 border-t border-danger/30 text-sm flex justify-between text-fg"
                >
                  <span>
                    {t("contacts.rowPhone", {
                      row: r.row,
                      phone: formatPhoneNumber(r.phoneNumber),
                    })}
                  </span>
                  <span className="text-danger">{r.error}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
