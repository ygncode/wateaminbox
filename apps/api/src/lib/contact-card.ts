export interface RawContactCard {
  displayName?: string;
  vcard?: string;
}

export interface ContactCardPhoneNumber {
  value: string;
  label?: string;
}

export interface ContactCardData {
  displayName: string;
  phoneNumbers: ContactCardPhoneNumber[];
}

const MAX_CONTACT_CARDS = 20;
const MAX_PHONE_NUMBERS = 10;
const MAX_DISPLAY_NAME_LENGTH = 200;
const MAX_PHONE_LENGTH = 40;

function unfoldVcard(value: string): string[] {
  return value
    .replace(/=\r?\n[ \t]?/g, "")
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/);
}

function decodeVcardValue(value: string): string {
  const unescaped = value
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
  if (!/=([0-9a-f]{2})/i.test(unescaped)) return unescaped;

  try {
    return decodeURIComponent(unescaped.replace(/=([0-9a-f]{2})/gi, "%$1"));
  } catch {
    return unescaped;
  }
}

function propertyName(rawKey: string): string {
  return (rawKey.split(".").at(-1) || rawKey).toUpperCase();
}

function normalizePhone(value: string): string | null {
  const candidate = decodeVcardValue(value).replace(/^tel:/i, "").trim();
  const hasLeadingPlus = candidate.startsWith("+");
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `${hasLeadingPlus ? "+" : ""}${digits}`.slice(0, MAX_PHONE_LENGTH);
}

function readableLabel(value: string): string | undefined {
  const label = decodeVcardValue(value)
    .replace(/^_\$!</, "")
    .replace(/>!\$_$/, "")
    .trim();
  if (!label) return undefined;
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

function nameFromStructuredValue(value: string): string {
  const [family = "", given = "", additional = "", prefix = "", suffix = ""] =
    decodeVcardValue(value).split(";");
  return [prefix, given, additional, family, suffix].filter(Boolean).join(" ");
}

function parseVcard(raw: string): ContactCardData | null {
  const lines = unfoldVcard(raw);
  let formattedName = "";
  let structuredName = "";
  const labelsByGroup = new Map<string, string>();
  const phones: Array<ContactCardPhoneNumber & { group?: string }> = [];

  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const descriptor = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [rawKey, ...parameters] = descriptor.split(";");
    const [group = "", rawProperty = ""] = rawKey.includes(".")
      ? rawKey.split(/\.(.+)/)
      : ["", rawKey];
    const property = propertyName(rawProperty);

    if (property === "FN" && !formattedName) {
      formattedName = decodeVcardValue(value);
      continue;
    }
    if (property === "N" && !structuredName) {
      structuredName = nameFromStructuredValue(value);
      continue;
    }
    if (property === "X-ABLABEL" && group) {
      const label = readableLabel(value);
      if (label) labelsByGroup.set(group, label);
      continue;
    }
    if (property !== "TEL") continue;

    const phone = normalizePhone(value);
    if (!phone) continue;
    const typeParameter = parameters.find((parameter) =>
      /^TYPE=/i.test(parameter),
    );
    const typeLabel = typeParameter
      ?.slice(typeParameter.indexOf("=") + 1)
      .split(",")
      .find((type) => !/^(voice|pref)$/i.test(type));
    phones.push({
      value: phone,
      label: typeLabel ? readableLabel(typeLabel) : undefined,
      group: group || undefined,
    });
  }

  const displayName = (formattedName || structuredName).trim();
  if (!displayName && phones.length === 0) return null;
  return {
    displayName: displayName.slice(0, MAX_DISPLAY_NAME_LENGTH),
    phoneNumbers: phones.slice(0, MAX_PHONE_NUMBERS).map((phone) => ({
      value: phone.value,
      label:
        (phone.group ? labelsByGroup.get(phone.group) : undefined) ||
        phone.label,
    })),
  };
}

/** Convert WhatsApp vCards into the small, typed shape the message UI needs. */
export function normalizeContactCards(
  cards: readonly RawContactCard[] | undefined,
  fallbackDisplayName = "",
): ContactCardData[] {
  const normalized = (cards || [])
    .slice(0, MAX_CONTACT_CARDS)
    .flatMap((card) => {
      const parsed = card.vcard ? parseVcard(card.vcard) : null;
      const displayName = (
        card.displayName ||
        parsed?.displayName ||
        ""
      ).trim();
      if (!displayName && !parsed) return [];
      return [
        {
          displayName: (displayName || "Shared contact").slice(
            0,
            MAX_DISPLAY_NAME_LENGTH,
          ),
          phoneNumbers: parsed?.phoneNumbers || [],
        },
      ];
    });

  if (normalized.length > 0) return normalized;
  const fallback = fallbackDisplayName.trim();
  return fallback
    ? [
        {
          displayName: fallback.slice(0, MAX_DISPLAY_NAME_LENGTH),
          phoneNumbers: [],
        },
      ]
    : [];
}
