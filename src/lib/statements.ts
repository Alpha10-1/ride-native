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

// Builds a printable HTML statement and hands it to expo-print, then opens
// the OS share sheet so the driver can save/send the resulting PDF.
// expo-print + expo-sharing generate and share the file entirely on-device
// — no server-side PDF generation involved.
export async function exportStatementPdf(params: {
  driverName: string;
  period: StatementPeriod;
  periodLabel: string;
  trips: StatementTrip[];
}) {
  const Print = await import("expo-print");
  const Sharing = await import("expo-sharing");

  const summary = summarizeStatement(params.trips);

  const rows = params.trips
    .map(
      (t) => `
        <tr>
          <td>${new Date(t.completed_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}</td>
          <td>${t.pickup_address} → ${t.destination_address}</td>
          <td>${t.ride_tier}</td>
          <td>${t.actual_distance_km?.toFixed(1) ?? "—"} km</td>
          <td style="text-align:right">${formatFare(t.final_fare_cents)}</td>
        </tr>`
    )
    .join("");

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; padding: 24px; }
          h1 { font-size: 20px; margin-bottom: 2px; }
          .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
          .summary { display: flex; gap: 24px; margin-bottom: 20px; }
          .summary div { flex: 1; }
          .summary .label { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 1px; }
          .summary .value { font-size: 18px; font-weight: 700; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
          th { color: #888; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
        </style>
      </head>
      <body>
        <h1>${params.driverName} — ${params.period === "weekly" ? "Weekly" : "Monthly"} Statement</h1>
        <div class="sub">${params.periodLabel}</div>
        <div class="summary">
          <div><div class="label">Trips</div><div class="value">${summary.tripCount}</div></div>
          <div><div class="label">Earnings</div><div class="value">${formatFare(summary.totalEarningsCents)}</div></div>
          <div><div class="label">Distance</div><div class="value">${summary.totalDistanceKm.toFixed(1)} km</div></div>
        </div>
        <table>
          <thead>
            <tr><th>Date</th><th>Trip</th><th>Tier</th><th>Distance</th><th style="text-align:right">Fare</th></tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="5" style="color:#999">No completed trips this period.</td></tr>`}</tbody>
        </table>
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Statement" });
  }
  return uri;
}