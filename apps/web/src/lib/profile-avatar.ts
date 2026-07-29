import {
  prepareWorkspaceLogo,
  validateWorkspaceLogo,
  WORKSPACE_LOGO_INPUT_BYTES,
  WORKSPACE_LOGO_OUTPUT_BYTES,
  WORKSPACE_LOGO_SIZE,
} from "./workspace-logo";

export const PROFILE_AVATAR_INPUT_BYTES = WORKSPACE_LOGO_INPUT_BYTES;
export const PROFILE_AVATAR_OUTPUT_BYTES = WORKSPACE_LOGO_OUTPUT_BYTES;
export const PROFILE_AVATAR_SIZE = WORKSPACE_LOGO_SIZE;

function profileMessage(message: string): string {
  return message
    .replace(/Logo/g, "Profile image")
    .replace(/logo/g, "profile image");
}

export function validateProfileAvatar(file: File): string | null {
  const error = validateWorkspaceLogo(file);
  return error ? profileMessage(error) : null;
}

/**
 * Center-crop and compress a user-selected image to a predictable square
 * profile avatar before it is sent to the API.
 */
export async function prepareProfileAvatar(file: File): Promise<string> {
  try {
    return await prepareWorkspaceLogo(file);
  } catch (error) {
    throw new Error(
      profileMessage(
        error instanceof Error ? error.message : "Could not process this image",
      ),
    );
  }
}
