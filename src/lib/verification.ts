import { supabase } from "./supabase";

export type DocType = "drivers_license" | "vehicle_registration" | "profile_photo";

export type DocStatus = "not_submitted" | "pending" | "approved" | "rejected";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

export type DriverDocument = {
  id: string;
  driver_id: string;
  doc_type: DocType;
  storage_path: string;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export const REQUIRED_DOCS: { type: DocType; label: string; description: string; icon: string }[] = [
  {
    type: "drivers_license",
    label: "Driver's license",
    description: "A clear photo of your valid driver's license",
    icon: "card-outline",
  },
  {
    type: "vehicle_registration",
    label: "Vehicle registration",
    description: "Proof of registration for the vehicle you'll drive",
    icon: "document-text-outline",
  },
  {
    type: "profile_photo",
    label: "Profile photo",
    description: "A recent photo of yourself for identity verification",
    icon: "person-circle-outline",
  },
];

export async function getMyDocuments(): Promise<DriverDocument[]> {
  const { data, error } = await supabase.from("driver_documents").select("*");
  if (error) throw error;
  return (data ?? []) as DriverDocument[];
}

export async function getMyVerificationStatus(): Promise<{
  status: VerificationStatus;
  notes: string | null;
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("profiles")
    .select("verification_status, verification_notes")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return {
    status: data.verification_status as VerificationStatus,
    notes: data.verification_notes as string | null,
  };
}

// Uploads a picked image (local file uri) to the private driver-documents
// bucket, then records it via the submit_driver_document RPC.
export async function uploadVerificationDocument(docType: DocType, localUri: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const ext = localUri.split(".").pop()?.split("?")[0] || "jpg";
  const path = `${userId}/${docType}.${ext}`;

  const response = await fetch(localUri);
  const arrayBuffer = await response.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("driver-documents")
    .upload(path, arrayBuffer, {
      contentType: response.headers.get("content-type") ?? "image/jpeg",
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase.rpc("submit_driver_document", {
    doc_type_in: docType,
    storage_path_in: path,
  });
  if (error) throw error;
  return data as DriverDocument;
}

export function docStatusFor(docs: DriverDocument[], type: DocType): DocStatus {
  const doc = docs.find((d) => d.doc_type === type);
  if (!doc) return "not_submitted";
  return doc.status;
}