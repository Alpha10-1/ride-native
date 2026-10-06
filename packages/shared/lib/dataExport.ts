// Backs the "Request my data" row on the Privacy screen
// (src/screens/PrivacyScreen.tsx). Pulls every ride the signed-in rider
// has ever been party to — any status, no date bounds — via
// get_rider_data_export (20260805120000_rider_data_export.sql), then
// renders it into a branded, shareable PDF using the same on-device
// expo-print → share-sheet approach as the spending report
// (src/lib/spendingReport.ts) and driver statements (src/lib/statements.ts).

import { supabase } from "./supabase";
import { formatFare } from "./rides";
import { PAYMENT_METHOD_LABELS, PaymentMethod } from "./payments";

export type RideDataRecord = {
  trip_id: string;
  status: string;
  pickup_label: string | null;
  pickup_address: string | null;
  destination_label: string | null;
  destination_address: string | null;
  ride_tier: string | null;
  requested_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  estimated_distance_km: number | null;
  actual_distance_km: number | null;
  estimated_fare_cents: number | null;
  final_fare_cents: number | null;
  cancellation_fee_cents: number | null;
  payment_method: PaymentMethod;
  payment_status: string;
  payment_reference: string | null;
  driver_first_name: string | null;
  driver_last_name: string | null;
  driver_vehicle_make: string | null;
  driver_vehicle_model: string | null;
  driver_license_plate: string | null;
};

export async function getMyRideDataExport(): Promise<RideDataRecord[]> {
  const { data, error } = await supabase.rpc("get_rider_data_export");
  if (error) throw error;
  return (data ?? []) as RideDataRecord[];
}

// The amount actually paid on a ride — final fare if the trip completed
// and was charged, cancellation fee if it was cancelled with a fee, else
// nothing was paid (still-pending / cancelled-without-fee / no-show).
export function amountPaidCents(r: RideDataRecord): number {
  if (r.status === "completed") return r.final_fare_cents ?? 0;
  if (r.status === "cancelled") return r.cancellation_fee_cents ?? 0;
  return 0;
}

export function driverDisplayName(r: RideDataRecord): string {
  const name = [r.driver_first_name, r.driver_last_name].filter(Boolean).join(" ").trim();
  return name || "—";
}

export function driverVehicleDisplay(r: RideDataRecord): string {
  const car = [r.driver_vehicle_make, r.driver_vehicle_model].filter(Boolean).join(" ").trim();
  if (!car && !r.driver_license_plate) return "—";
  return [car || null, r.driver_license_plate ? `(${r.driver_license_plate})` : null]
    .filter(Boolean)
    .join(" ");
}

export type RideDataSummary = {
  totalTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  totalDistanceKm: number;
  totalPaidCents: number;
  paymentMethodBreakdown: Partial<Record<PaymentMethod, number>>;
};

export function summarizeRideData(rides: RideDataRecord[]): RideDataSummary {
  const summary: RideDataSummary = {
    totalTrips: rides.length,
    completedTrips: 0,
    cancelledTrips: 0,
    totalDistanceKm: 0,
    totalPaidCents: 0,
    paymentMethodBreakdown: {},
  };

  for (const r of rides) {
    if (r.status === "completed") summary.completedTrips += 1;
    if (r.status === "cancelled") summary.cancelledTrips += 1;
    summary.totalDistanceKm += r.actual_distance_km ?? 0;
    const paid = amountPaidCents(r);
    summary.totalPaidCents += paid;
    if (paid > 0) {
      summary.paymentMethodBreakdown[r.payment_method] =
        (summary.paymentMethodBreakdown[r.payment_method] ?? 0) + paid;
    }
  }

  return summary;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtKm(km: number | null): string {
  return km != null ? `${km.toFixed(1)} km` : "—";
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    case "scheduled": return "Scheduled";
    default: return status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}

export async function exportRideDataPdf(params: {
  riderName: string;
  rides: RideDataRecord[];
}) {
  const Print = await import("expo-print");
  const Sharing = await import("expo-sharing");
  const { brandStyles, brandHeader, brandFooter, makeDocRef } = await import("./pdfBranding");

  const summary = summarizeRideData(params.rides);
  const docRef = makeDocRef("DATA", new Date());

  const paymentBreakdownRows = (Object.entries(summary.paymentMethodBreakdown) as [PaymentMethod, number][])
    .map(([method, cents]) => `${PAYMENT_METHOD_LABELS[method] ?? method}: ${formatFare(cents)}`)
    .join(" · ");

  const rows = params.rides
    .map((r) => {
      const trip = [r.pickup_label || r.pickup_address, r.destination_label || r.destination_address]
        .map((s) => s || "—")
        .join(" → ");
      const paid = amountPaidCents(r);
      return `
        <tr>
          <td>${fmtDate(r.completed_at || r.cancelled_at || r.requested_at)}</td>
          <td>${trip}</td>
          <td>${statusLabel(r.status)}</td>
          <td>${fmtKm(r.actual_distance_km ?? r.estimated_distance_km)}</td>
          <td>${paid > 0 ? formatFare(paid) : "—"}</td>
          <td>${PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method}</td>
          <td>${driverDisplayName(r)}</td>
          <td>${driverVehicleDisplay(r)}</td>
        </tr>`;
    })
    .join("");

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${brandStyles()}
          table { font-size: 9.5px; }
        </style>
      </head>
      <body>
        ${brandHeader("Your Ride Data", docRef)}

        <div class="party-block">
          <div class="party">
            <div class="label">Rider</div>
            <div class="name">${params.riderName}</div>
          </div>
          <div class="party" style="text-align:right">
            <div class="label">Covering</div>
            <div class="name">All rides on record</div>
          </div>
        </div>

        <div class="summary">
          <div class="card"><div class="label">Total Trips</div><div class="value">${summary.totalTrips}</div></div>
          <div class="card"><div class="label">Completed</div><div class="value">${summary.completedTrips}</div></div>
          <div class="card"><div class="label">Total Distance</div><div class="value">${summary.totalDistanceKm.toFixed(1)} km</div></div>
          <div class="card highlight"><div class="label">Total Paid</div><div class="value">${formatFare(summary.totalPaidCents)}</div></div>
        </div>

        ${paymentBreakdownRows ? `<div class="party" style="margin-bottom:16px;"><div class="label">By Payment Method</div><div class="detail">${paymentBreakdownRows}</div></div>` : ""}

        <table>
          <thead>
            <tr>
              <th>Date</th><th>Trip</th><th>Status</th><th>Distance</th>
              <th class="num">Paid</th><th>Payment</th><th>Driver</th><th>Vehicle</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="8" class="empty-note">No rides on record.</td></tr>`}
          </tbody>
        </table>

        ${brandFooter()}
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Your Ride Data" });
  }
  return uri;
}
