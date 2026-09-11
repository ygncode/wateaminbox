import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ApiRequestError, api } from "@/lib/api/client";
import { formatPhoneLikeText } from "@/lib/utils";
import { queryKeys } from "../query-keys";
import { groupKeys, type GroupDetail } from "../useGroups";

/**
 * Contact detail from API with extended fields
 */
export interface ContactDetail {
  id: string;
  jid: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  username?: string | null;
  customName: string | null;
  displayName: string;
  isGroup: boolean;
  isBlocked: boolean;
  isOnline: boolean;
  lastSeen: string | null;
  profilePictureUrl: string | null;
  notesShared: string | null;
  createdAt: string;
  updatedAt: string;
  conversationId?: string | null;
  channel?: string | null;
  provider?: string | null;
  connection: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    status: "disconnected" | "pending" | "connected" | "banned" | "error";
  } | null;
  assignment: {
    assignedTo: string;
    assignedToName: string;
    assignedBy: string;
    assignedByName: string;
    assignedAt: string;
  } | null;
  tags: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
}

/**
 * Input for creating a new contact
 */
export interface CreateContactInput {
  phoneNumber: string;
  connectionId?: string;
  customName?: string;
  notesShared?: string;
}

/**
 * Response from creating a contact
 */
export interface CreateContactResponse {
  id: string;
  jid: string;
  phoneNumber: string;
  customName: string | null;
  displayName: string;
  notesShared: string | null;
  isGroup: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hook to fetch a single contact's details
 */
export function useContact(contactId: string | null) {
  return useQuery({
    queryKey: queryKeys.contacts.detail(contactId ?? ""),
    queryFn: async () => {
      if (!contactId) throw new Error("No contact ID provided");
      const response = await api.get<ContactDetail>(`/contacts/${contactId}`);
      return response;
    },
    select: (contact) => ({
      ...contact,
      displayName: formatPhoneLikeText(contact.displayName),
      pushName: contact.pushName
        ? formatPhoneLikeText(contact.pushName)
        : contact.pushName,
    }),
    enabled: !!contactId,
    retry: (failureCount, error) => {
      if (error instanceof ApiRequestError && error.statusCode === 404) {
        return false;
      }
      return failureCount < 3;
    },
    staleTime: 30_000, // 30 seconds
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Applies a `PATCH /contacts/:id` response to every cache that renders it.
 *
 * A group's alias is edited through the *contacts* endpoint, but the groups
 * sidebar (`groupKeys.lists()`) and the leave-group dialog
 * (`groupKeys.detail`) render from the separate `groups` query domain.
 * Invalidation is prefix-based, so `contacts.all` never reached either one and
 * a rename left both showing the old alias until an unrelated refetch.
 *
 * The PATCH response carries no `isGroup`, so group handling is decided by the
 * cached contact the profile panel rendered from.
 */
export function applyContactUpdateToCaches(
  queryClient: QueryClient,
  params: { contactId: string; update: ContactDetail },
): void {
  const { contactId, update } = params;
  const cachedContact = queryClient.getQueryData<ContactDetail>(
    queryKeys.contacts.detail(contactId),
  );

  queryClient.setQueryData(
    queryKeys.contacts.detail(contactId),
    (old: ContactDetail | undefined) => {
      if (!old) return update;
      return { ...old, ...update };
    },
  );
  queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });

  if (!cachedContact?.isGroup) return;

  queryClient.setQueryData(
    groupKeys.detail(contactId),
    (old: GroupDetail | undefined) => {
      if (!old) return old;
      return {
        ...old,
        customName: update.customName,
        displayName: update.customName || old.name || "Unknown Group",
        updatedAt: update.updatedAt,
      };
    },
  );
  queryClient.invalidateQueries({ queryKey: groupKeys.lists() });
}

/**
 * Hook to update a contact's custom name or shared notes
 */
export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      customName,
      notesShared,
    }: {
      contactId: string;
      customName?: string;
      notesShared?: string;
    }) => {
      const response = await api.patch<ContactDetail>(
        `/contacts/${contactId}`,
        {
          customName,
          notesShared,
        },
      );
      return response;
    },
    onSuccess: (data, variables) => {
      applyContactUpdateToCaches(queryClient, {
        contactId: variables.contactId,
        update: data,
      });
    },
  });
}

/**
 * Hook to create a new contact by phone number
 */
export function useCreateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateContactInput) => {
      const response = await api.post<CreateContactResponse>(
        "/contacts",
        input,
      );
      return response;
    },
    onSuccess: () => {
      // Invalidate contacts list to show the new contact
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}

/**
 * Response from block/unblock contact API
 */
interface BlockContactResponse {
  id: string;
  isBlocked: boolean;
  updatedAt: string;
}

/**
 * Hook to block or unblock a contact
 *
 * Uses optimistic updates for instant UI feedback.
 * On error, reverts to previous state.
 */
export function useBlockContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      isBlocked,
    }: {
      contactId: string;
      isBlocked: boolean;
    }) => {
      const response = await api.patch<BlockContactResponse>(
        `/contacts/${contactId}`,
        { isBlocked },
      );
      return response;
    },
    onMutate: async ({ contactId, isBlocked }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.contacts.detail(contactId),
      });

      // Snapshot the previous value
      const previousContact = queryClient.getQueryData<ContactDetail>(
        queryKeys.contacts.detail(contactId),
      );

      // Optimistically update to the new value
      if (previousContact) {
        queryClient.setQueryData(queryKeys.contacts.detail(contactId), {
          ...previousContact,
          isBlocked,
        });
      }

      // Return a context object with the snapshotted value
      return { previousContact };
    },
    onError: (_error, variables, context) => {
      // Rollback to the previous value on error
      if (context?.previousContact) {
        queryClient.setQueryData(
          queryKeys.contacts.detail(variables.contactId),
          context.previousContact,
        );
      }
    },
    onSettled: (_data, _error, variables) => {
      // Always refetch after error or success to ensure data is in sync
      queryClient.invalidateQueries({
        queryKey: queryKeys.contacts.detail(variables.contactId),
      });
      // Also invalidate the contacts list to update block status there
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    },
  });
}
