import { describe, expect, test } from "bun:test";
import { getProfilePictureRequestJid } from "./profile-picture-request";

const directMessage = {
  isGroupMessage: false,
  isHistorySync: false,
  fromMe: false,
  contactJid: "15551234567@s.whatsapp.net",
  contactProfilePictureUrl: null,
  senderJid: "15551234567@s.whatsapp.net",
};

describe("getProfilePictureRequestJid", () => {
  test("requests a missing direct-contact picture after a live message", () => {
    expect(getProfilePictureRequestJid(directMessage)).toBe(
      directMessage.contactJid,
    );
  });

  test("does not refetch a direct contact that already has a picture", () => {
    expect(
      getProfilePictureRequestJid({
        ...directMessage,
        contactProfilePictureUrl:
          "s3://whatsapp-media/media/company/contact.jpg",
      }),
    ).toBeNull();
  });

  test("does not duplicate direct-contact fetching during history sync", () => {
    expect(
      getProfilePictureRequestJid({ ...directMessage, isHistorySync: true }),
    ).toBeNull();
  });

  test("retains on-demand fetching for incoming group participants", () => {
    expect(
      getProfilePictureRequestJid({
        ...directMessage,
        isGroupMessage: true,
        isHistorySync: true,
        contactJid: "120363000000000000@g.us",
        senderJid: "15557654321@s.whatsapp.net",
      }),
    ).toBe("15557654321@s.whatsapp.net");
  });

  test("does not request a group picture for the workspace's own message", () => {
    expect(
      getProfilePictureRequestJid({
        ...directMessage,
        isGroupMessage: true,
        fromMe: true,
        contactJid: "120363000000000000@g.us",
      }),
    ).toBeNull();
  });
});
