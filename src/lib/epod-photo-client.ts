import { EPOD_MAX_PHOTO_BYTES } from "./epod-photo";

export async function prepareDeliveryPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose a photo smaller than 12 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is unavailable on this device.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const result = canvas.toDataURL("image/jpeg", quality);
      if (result.startsWith("data:image/jpeg;base64,") && (result.length - 23) * 0.75 <= EPOD_MAX_PHOTO_BYTES) return result;
    }
    throw new Error("This photo is too detailed. Choose a smaller photo.");
  } finally { bitmap.close(); }
}
