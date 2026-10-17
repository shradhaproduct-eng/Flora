export const formatCurrency = (value) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(
    Number.isFinite(value) ? value : 0
  );

// Builds a friendly default name from the flowers currently in the
// arrangement, e.g. "Rose & Tulip Bouquet" or "Rose, Lily & Peony Bouquet".
// Falls back to a timestamped name when nothing is selected yet.
export function generateDefaultName(items) {
  const names = items
    .filter((item) => item.flower_name && Number(item.stems) > 0)
    .sort((a, b) => Number(b.stems) - Number(a.stems))
    .map((item) => item.flower_name);

  if (names.length === 0) {
    return `New Arrangement — ${new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })}`;
  }

  const unique = [...new Set(names)].slice(0, 3);
  const label =
    unique.length === 1
      ? unique[0]
      : `${unique.slice(0, -1).join(", ")} & ${unique[unique.length - 1]}`;
  return `${label} Bouquet`;
}

export function emptyItem() {
  return { key: crypto.randomUUID(), flower_id: null, flower_name: "", stem_price: 0, stems: 1 };
}

// Reads an image file and returns a downscaled JPEG data URL, so photos
// from a phone camera stay small enough to upload and store.
export function resizeImage(file, maxSize, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // transparent PNGs would otherwise turn black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image file."));
    };
    img.src = url;
  });
}
