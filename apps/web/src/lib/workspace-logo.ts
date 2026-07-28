export const WORKSPACE_LOGO_INPUT_BYTES = 5 * 1024 * 1024;
export const WORKSPACE_LOGO_OUTPUT_BYTES = 512 * 1024;
export const WORKSPACE_LOGO_SIZE = 512;

const SUPPORTED_LOGO_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SUPPORTED_LOGO_EXTENSIONS = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

function hasSupportedLogoType(file: File): boolean {
  const type = file.type.trim().toLowerCase();
  if (type) return SUPPORTED_LOGO_TYPES.has(type);

  const extension = file.name.split(".").pop()?.toLowerCase();
  return Boolean(extension && SUPPORTED_LOGO_EXTENSIONS.has(extension));
}

export function validateWorkspaceLogo(file: File): string | null {
  if (!hasSupportedLogoType(file)) {
    return "Choose a PNG, JPEG, WebP, GIF, or AVIF image.";
  }
  if (file.size > WORKSPACE_LOGO_INPUT_BYTES) {
    return "Logo must be 5 MB or smaller.";
  }
  return null;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not process this image")),
      type,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("Could not read the processed logo"));
    reader.readAsDataURL(blob);
  });
}

async function loadImage(file: File): Promise<
  CanvasImageSource & {
    width: number;
    height: number;
  }
> {
  if (typeof window.createImageBitmap === "function") {
    try {
      return await window.createImageBitmap(file, {
        imageOrientation: "from-image",
      });
    } catch {
      // Some embedded browsers expose createImageBitmap but cannot decode all
      // raster formats. The image element path is more broadly compatible.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(
        "This image could not be opened. Try exporting it as PNG or JPEG.",
      );
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Center-crops any supported source image to a consistent square workspace
 * avatar and compresses it before it is sent to the API.
 */
export async function prepareWorkspaceLogo(file: File): Promise<string> {
  const validationError = validateWorkspaceLogo(file);
  if (validationError) throw new Error(validationError);

  const image = await loadImage(file);
  try {
    if (image.width < 128 || image.height < 128) {
      throw new Error("Logo must be at least 128 × 128 pixels.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = WORKSPACE_LOGO_SIZE;
    canvas.height = WORKSPACE_LOGO_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable");

    const sourceSize = Math.min(image.width, image.height);
    const sourceX = (image.width - sourceSize) / 2;
    const sourceY = (image.height - sourceSize) / 2;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      WORKSPACE_LOGO_SIZE,
      WORKSPACE_LOGO_SIZE,
    );

    let quality = 0.88;
    let processed = await canvasToBlob(canvas, "image/webp", quality);
    while (processed.size > WORKSPACE_LOGO_OUTPUT_BYTES && quality > 0.52) {
      quality -= 0.08;
      processed = await canvasToBlob(canvas, "image/webp", quality);
    }
    if (processed.size > WORKSPACE_LOGO_OUTPUT_BYTES) {
      throw new Error("This image is too detailed to optimize below 512 KB.");
    }

    return blobToDataUrl(processed);
  } finally {
    if ("close" in image && typeof image.close === "function") image.close();
  }
}
