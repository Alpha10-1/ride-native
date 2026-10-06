import { Platform } from "react-native";

// expo-print writes generated PDFs into the app's private cache directory —
// invisible to any file manager, and liable to be cleared by the OS at any
// time. The share sheet (expo-sharing) only ever hands that same
// cache-directory file to whichever app the person picks; if they don't
// pick one, or later go looking in Files/Downloads, there's nothing there.
// "I have to share it to WhatsApp to access it" is a symptom of exactly
// this — WhatsApp is the only thing actually making a persistent copy.
//
// On Android this writes a real, persistent copy via the Storage Access
// Framework (the standard "let the user pick where files are saved" API —
// they'll be prompted once for a folder, Downloads is the natural choice)
// so the PDF shows up in their file manager/Downloads like any other
// downloaded file. On iOS there's no folder-picker equivalent; the share
// sheet's built-in "Save to Files" option is already the idiomatic way to
// do this, so iOS keeps using the share sheet directly.
export async function saveOrSharePdf(
  uri: string,
  filename: string, // e.g. "RIDE-Statement-2026-08.pdf"
  dialogTitle: string
): Promise<{ savedToDevice: boolean }> {
  if (Platform.OS === "android") {
    try {
      const FileSystem = await import("expo-file-system/legacy");
      const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (perms.granted) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const nameWithoutExt = filename.replace(/\.pdf$/i, "");
        const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perms.directoryUri,
          nameWithoutExt,
          "application/pdf"
        );
        await FileSystem.writeAsStringAsync(destUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return { savedToDevice: true };
      }
      // Permission denied — fall through to the share sheet below rather
      // than leaving the driver/rider with no way to get the file at all.
    } catch (e) {
      console.warn("[pdfSave] Storage Access Framework save failed, falling back to share sheet:", e);
    }
  }

  const Sharing = await import("expo-sharing");
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle });
  }
  return { savedToDevice: false };
}
