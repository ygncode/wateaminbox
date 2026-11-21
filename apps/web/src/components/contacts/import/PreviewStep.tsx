import { AlertCircle, Check } from "lucide-react";
import { formatPhoneNumber } from "@/lib/utils";
import type { PreviewStepProps } from "./types";
import { Trans, useTranslation } from "react-i18next";

export function PreviewStep({
  preview,
  options,
  onOptionsChange,
}: PreviewStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-info-soft rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-info">{preview.total}</div>
          <div className="text-sm text-info">
            {t("contacts.totalContacts", "Total contacts")}
          </div>
        </div>
        <div className="bg-accent-soft rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-accent">
            {preview.newCount}
          </div>
          <div className="text-sm text-accent">
            {t("contacts.newContacts", "New contacts")}
          </div>
        </div>
        <div className="bg-warning-soft rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-warning">
            {preview.existingCount}
          </div>
          <div className="text-sm text-warning">
            {t("contacts.alreadyExist", "Already exist")}
          </div>
        </div>
      </div>

      {/* Target connection */}
      <p className="text-sm text-fg-muted">
        <Trans
          i18nKey="contacts.linkedTo"
          values={{
            name: `${preview.connection.name || t("contacts.whatsappAccount")}${
              preview.connection.phoneNumber
                ? ` (${formatPhoneNumber(preview.connection.phoneNumber)})`
                : ""
            }`,
          }}
          components={{
            strong: <span className="font-medium text-fg" />,
          }}
        />
      </p>

      {/* Options */}
      <div className="space-y-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.updateExisting}
            onChange={(e) =>
              onOptionsChange({ ...options, updateExisting: e.target.checked })
            }
            className="h-4 w-4 rounded border-line-strong text-info focus:ring-info"
          />
          <span className="text-sm text-fg">
            {t(
              "contacts.updateExisting",
              "Update existing contacts with new data",
            )}
          </span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.createTags}
            onChange={(e) =>
              onOptionsChange({ ...options, createTags: e.target.checked })
            }
            className="h-4 w-4 rounded border-line-strong text-info focus:ring-info"
          />
          <span className="text-sm text-fg">
            {t("contacts.createNewTags", "Create new tags if they don't exist")}
          </span>
        </label>
      </div>

      {/* Preview table */}
      <div className="border border-line rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-2 text-start font-medium text-fg-muted">
                #
              </th>
              <th className="px-4 py-2 text-start font-medium text-fg-muted">
                {t("contacts.phone")}
              </th>
              <th className="px-4 py-2 text-start font-medium text-fg-muted">
                {t("contacts.name")}
              </th>
              <th className="px-4 py-2 text-start font-medium text-fg-muted">
                {t("contacts.status")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {preview.preview.slice(0, 10).map((row) => (
              <tr key={row.row} className="hover:bg-muted">
                <td className="px-4 py-2 text-fg-subtle">{row.row}</td>
                <td className="px-4 py-2 text-fg">
                  {formatPhoneNumber(row.phoneNumber)}
                </td>
                <td className="px-4 py-2 text-fg">{row.name || "-"}</td>
                <td className="px-4 py-2">
                  {row.exists ? (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertCircle className="h-3 w-3" />
                      {t("contacts.exists")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-accent">
                      <Check className="h-3 w-3" />
                      {t("contacts.newLabel")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.total > 10 && (
          <div className="px-4 py-2 bg-muted text-sm text-fg-muted text-center">
            {t("contacts.andMore", { count: preview.total - 10 })}
          </div>
        )}
      </div>
    </div>
  );
}
