// 保存する前に写真を縮める。スマホの写真は1枚3〜5MBあり、そのまま保存すると
// 端末の容量を圧迫し、クローゼットの一覧やバックアップも重くなるため。
const MAX_SIDE = 1280;
const QUALITY = 0.85;

export async function shrinkPhoto(photo: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(photo);
  } catch {
    // 読めない形式はそのまま保存する（判定のほうで分かりやすいエラーになる）
    return photo;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const small = await toJpeg(bitmap, width, height);
    return small && small.size < photo.size ? small : photo;
  } finally {
    bitmap.close();
  }
}

async function toJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
  }
  // 古いSafariなど OffscreenCanvas がない環境
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
}
