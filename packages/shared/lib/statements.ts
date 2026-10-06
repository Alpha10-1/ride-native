import { supabase } from "./supabase";
import { formatFare } from "./rides";

export type StatementTrip = {
  trip_id: string;
  completed_at: string;
  pickup_address: string;
  destination_address: string;
  ride_tier: string;
  actual_distance_km: number | null;
  actual_duration_min: number | null;
  final_fare_cents: number;
};

export type StatementPeriod = "weekly" | "monthly";

// Monday-start ISO week containing `date`.
export function getWeekBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  const day = start.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export function getMonthBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

export function getPeriodBounds(period: StatementPeriod, anchor: Date) {
  return period === "weekly" ? getWeekBounds(anchor) : getMonthBounds(anchor);
}

export function shiftPeriod(period: StatementPeriod, anchor: Date, direction: 1 | -1): Date {
  const next = new Date(anchor);
  if (period === "weekly") next.setDate(next.getDate() + direction * 7);
  else next.setMonth(next.getMonth() + direction);
  return next;
}

export function formatPeriodLabel(period: StatementPeriod, anchor: Date): string {
  const { start, end } = getPeriodBounds(period, anchor);
  const lastDay = new Date(end.getTime() - 1);
  if (period === "weekly") {
    const startTxt = start.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
    const endTxt = lastDay.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
    return `${startTxt} – ${endTxt}`;
  }
  return start.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

export async function getDriverStatement(start: Date, end: Date): Promise<StatementTrip[]> {
  const { data, error } = await supabase.rpc("get_driver_statement", {
    period_start_in: start.toISOString(),
    period_end_in: end.toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as StatementTrip[];
}

export type StatementSummary = {
  tripCount: number;
  totalEarningsCents: number;
  totalDistanceKm: number;
  totalDurationMin: number;
};

export function summarizeStatement(trips: StatementTrip[]): StatementSummary {
  return trips.reduce(
    (acc, t) => ({
      tripCount: acc.tripCount + 1,
      totalEarningsCents: acc.totalEarningsCents + (t.final_fare_cents ?? 0),
      totalDistanceKm: acc.totalDistanceKm + (t.actual_distance_km ?? 0),
      totalDurationMin: acc.totalDurationMin + (t.actual_duration_min ?? 0),
    }),
    { tripCount: 0, totalEarningsCents: 0, totalDistanceKm: 0, totalDurationMin: 0 }
  );
}

// Builds a printable HTML statement, hands it to expo-print, then saves it
// to a persistent, user-visible location on the device (see pdfSave.ts) —
// falling back to the OS share sheet if that's not possible.
export async function exportStatementPdf(params: {
  driverName: string;
  vehicleLabel?: string; // e.g. "Toyota Corolla · CA 123-456"
  period: StatementPeriod;
  periodLabel: string;
  periodStart: Date;
  trips: StatementTrip[];
}) {
  const Print = await import("expo-print");
  const { brandStyles, brandHeader, brandFooter, makeDocRef } = await import("./pdfBranding");

  const summary = summarizeStatement(params.trips);
  const docRef = makeDocRef("STMT", params.periodStart);

  const rows = params.trips
    .map(
      (t) => `
        <tr>
          <td>${new Date(t.completed_at).toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" })}</td>
          <td>${t.pickup_address} → ${t.destination_address}</td>
          <td>${t.ride_tier}</td>
          <td class="num">${t.actual_distance_km?.toFixed(1) ?? "—"} km</td>
          <td class="num">${formatFare(t.final_fare_cents)}</td>
        </tr>`
    )
    .join("");

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${brandStyles()}</style>
      </head>
      <body>
        ${brandHeader(
          `${params.period === "weekly" ? "Weekly" : "Monthly"} Driver Statement`,
          docRef
        )}

        <div class="party-block">
          <div class="party">
            <div class="label">Driver</div>
            <div class="name">${params.driverName}</div>
            ${params.vehicleLabel ? `<div class="detail">${params.vehicleLabel}</div>` : ""}
          </div>
          <div class="party" style="text-align:right">
            <div class="label">Statement Period</div>
            <div class="name">${params.periodLabel}</div>
          </div>
        </div>

        <div class="summary">
          <div class="card"><div class="label">Trips Completed</div><div class="value">${summary.tripCount}</div></div>
          <div class="card"><div class="label">Distance Covered</div><div class="value">${summary.totalDistanceKm.toFixed(1)} km</div></div>
          <div class="card highlight"><div class="label">Net Earnings</div><div class="value">${formatFare(summary.totalEarningsCents)}</div></div>
        </div>

        <table>
          <thead>
            <tr><th>Date</th><th>Trip</th><th>Tier</th><th class="num">Distance</th><th class="num">Fare</th></tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5" class="empty-note">No completed trips in this period.</td></tr>`}
          </tbody>
          ${
            params.trips.length > 0
              ? `<tfoot><tr class="total-row"><td colspan="4">Total Earnings</td><td class="num">${formatFare(summary.totalEarningsCents)}</td></tr></tfoot>`
              : ""
          }
        </table>

        ${brandFooter()}
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  const filename = `RIDE-Statement-${docRef}.pdf`;
  const { saveOrSharePdf } = await import("./pdfSave");
  const { savedToDevice } = await saveOrSharePdf(uri, filename, "Statement");
  return { uri, savedToDevice };
}