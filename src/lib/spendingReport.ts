import { supabase } from "./supabase";
import { formatFare } from "./rides";
import { PAYMENT_METHOD_LABELS, PaymentMethod } from "./payments";
import {
  StatementPeriod,
  getPeriodBounds,
  shiftPeriod,
  formatPeriodLabel,
} from "./statements";

// Re-export the period helpers — identical Monday-start-week /
// calendar-month logic as the driver statement, no reason to duplicate it.
export { getPeriodBounds, shiftPeriod, formatPeriodLabel };
export type { StatementPeriod };

export type SpendingTrip = {
  trip_id: string;
  completed_at: string;
  pickup_address: string;
  destination_address: string;
  ride_tier: string;
  final_fare_cents: number;
  payment_method: PaymentMethod;
};

export async function getRiderSpending(start: Date, end: Date): Promise<SpendingTrip[]> {
  const { data, error } = await supabase.rpc("get_rider_spending", {
    period_start_in: start.toISOString(),
    period_end_in: end.toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as SpendingTrip[];
}

export type SpendingSummary = {
  tripCount: number;
  totalSpentCents: number;
};

export function summarizeSpending(trips: SpendingTrip[]): SpendingSummary {
  return trips.reduce(
    (acc, t) => ({
      tripCount: acc.tripCount + 1,
      totalSpentCents: acc.totalSpentCents + (t.final_fare_cents ?? 0),
    }),
    { tripCount: 0, totalSpentCents: 0 }
  );
}

// Builds a printable HTML spending report, hands it to expo-print, then
// saves it to a persistent, user-visible location on the device (see
// pdfSave.ts) — falling back to the OS share sheet if that's not
// possible. Reuses the same branded template as the driver statement
// (src/lib/statements.ts) so both documents look consistent.
export async function exportSpendingReportPdf(params: {
  riderName: string;
  period: StatementPeriod;
  periodLabel: string;
  periodStart: Date;
  trips: SpendingTrip[];
}) {
  const Print = await import("expo-print");
  const { brandStyles, brandHeader, brandFooter, makeDocRef } = await import("./pdfBranding");

  const summary = summarizeSpending(params.trips);
  const docRef = makeDocRef("SPEND", params.periodStart);

  const rows = params.trips
    .map(
      (t) => `
        <tr>
          <td>${new Date(t.completed_at).toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" })}</td>
          <td>${t.pickup_address} → ${t.destination_address}</td>
          <td>${t.ride_tier}</td>
          <td>${PAYMENT_METHOD_LABELS[t.payment_method] ?? t.payment_method}</td>
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
          `${params.period === "weekly" ? "Weekly" : "Monthly"} Spending Report`,
          docRef
        )}

        <div class="party-block">
          <div class="party">
            <div class="label">Rider</div>
            <div class="name">${params.riderName}</div>
          </div>
          <div class="party" style="text-align:right">
            <div class="label">Report Period</div>
            <div class="name">${params.periodLabel}</div>
          </div>
        </div>

        <div class="summary">
          <div class="card"><div class="label">Trips Taken</div><div class="value">${summary.tripCount}</div></div>
          <div class="card highlight"><div class="label">Total Spent</div><div class="value">${formatFare(summary.totalSpentCents)}</div></div>
        </div>

        <table>
          <thead>
            <tr><th>Date</th><th>Trip</th><th>Tier</th><th>Payment</th><th class="num">Amount</th></tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5" class="empty-note">No completed trips in this period.</td></tr>`}
          </tbody>
          ${
            params.trips.length > 0
              ? `<tfoot><tr class="total-row"><td colspan="4">Total Spent</td><td class="num">${formatFare(summary.totalSpentCents)}</td></tr></tfoot>`
              : ""
          }
        </table>

        ${brandFooter()}
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  const filename = `RIDE-SpendingReport-${docRef}.pdf`;
  const { saveOrSharePdf } = await import("./pdfSave");
  const { savedToDevice } = await saveOrSharePdf(uri, filename, "Spending Report");
  return { uri, savedToDevice };
}
