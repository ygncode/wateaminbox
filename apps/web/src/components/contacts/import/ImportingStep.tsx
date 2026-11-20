import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ImportingStep() {
  const { t } = useTranslation();

  return (
    <div className="py-12 text-center">
      <Loader2 className="h-12 w-12 mx-auto text-info animate-spin" />
      <p className="mt-4 text-lg font-medium text-fg">
        {t("contacts.importing", "Importing contacts...")}
      </p>
      <p className="mt-1 text-sm text-fg-muted">
        {t("contacts.importingHint", "This may take a moment")}
      </p>
    </div>
  );
}
