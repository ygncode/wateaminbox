import { describe, expect, test } from "bun:test";
import { normalizeContactCards } from "./contact-card";

describe("WhatsApp contact cards", () => {
  test("extracts a name and labeled phone numbers from a vCard", () => {
    expect(
      normalizeContactCards([
        {
          displayName: "My Universe 🌟❤️",
          vcard: [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "N:Universe;My;;;",
            "FN:My Universe 🌟❤️",
            "item1.TEL;waid=6591234567:+65 9123 4567",
            "item1.X-ABLabel:Mobile",
            "TEL;TYPE=WORK:+1 (415) 555-0100",
            "END:VCARD",
          ].join("\n"),
        },
      ]),
    ).toEqual([
      {
        displayName: "My Universe 🌟❤️",
        phoneNumbers: [
          { value: "+6591234567", label: "Mobile" },
          { value: "+14155550100", label: "Work" },
        ],
      },
    ]);
  });

  test("keeps a useful fallback for legacy cards without vCard data", () => {
    expect(normalizeContactCards(undefined, "<3")).toEqual([
      { displayName: "<3", phoneNumbers: [] },
    ]);
  });
});
