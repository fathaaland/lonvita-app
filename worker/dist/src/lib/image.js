/**
 * Brief §4 "Nahrání fotografie k akci" — photos straight off a phone are often 5–30 MB, but the
 * Next.js proxy (src/proxy.ts) buffers request bodies and cuts them off at its size limit, which
 * surfaced as a failed upload ("Unexpected end of form" on the server). Downscaling in the browser
 * first keeps every upload small; the server still generates the fixed 16:10 card crop itself.
 */
const MAX_DIMENSION = 2560;
const JPEG_QUALITY = 0.85;
const PASSTHROUGH_MAX_BYTES = 2 * 1024 * 1024;
const PASSTHROUGH_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** A user-facing (Czech) reason the picked file can't be uploaded. */
export class ImageUploadError extends Error {
}
export async function prepareImageForUpload(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    }
    catch {
        throw new ImageUploadError("Tento formát fotky prohlížeč neumí zpracovat (např. HEIC z iPhonu). Uložte ji prosím jako JPG nebo PNG.");
    }
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= PASSTHROUGH_MAX_BYTES && PASSTHROUGH_TYPES.includes(file.type)) {
        bitmap.close();
        return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        bitmap.close();
        throw new ImageUploadError("Fotku se nepodařilo zpracovat.");
    }
    // JPEG has no alpha — paint white first so transparent PNGs don't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob)
        throw new ImageUploadError("Fotku se nepodařilo zpracovat.");
    const baseName = file.name.replace(/\.[^.]+$/, "") || "fotografie";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}
