/**
 * Clipboard and download helpers for the share dialog (ShareEventDialog, FacebookEventGuide) —
 * browser-only.
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Facebook's and Instagram's in-app browsers (where a shared link opens) and older Safari may
    // refuse the Clipboard API — copy the old way. Inside the dialog, whose focus trap would
    // otherwise take the selection away.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    (document.activeElement?.closest('[role="dialog"]') ?? document.body).appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

export function downloadFile(file: File): void {
  const href = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = href;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
