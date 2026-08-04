// Shared branding for on-device generated PDFs (expo-print HTML → PDF).
// Used by both the driver statement (src/lib/statements.ts) and the
// rider spending report (src/lib/spendingReport.ts) so both documents
// look like they came from the same company rather than two different
// one-off exports.
//
// The logo is a CSS wordmark, not a raster image — it exactly mirrors
// the in-app brand mark (SideMenuDrawer's "Ride" title: white "R" + red
// "ide") and renders identically every time across iOS/Android's PDF
// engines with zero asset-loading risk, unlike embedding a bundled PNG.

export const BRAND_RED = "#ff2e2e";
export const BRAND_INK = "#111111";

export function brandStyles(): string {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: ${BRAND_INK};
      padding: 32px 36px;
      margin: 0;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid ${BRAND_RED};
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .wordmark { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
    .wordmark .r { color: ${BRAND_INK}; }
    .wordmark .ide { color: ${BRAND_RED}; }
    .wordmark-sub { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #999; margin-top: 2px; }
    .doc-meta { text-align: right; font-size: 11px; color: #666; line-height: 1.6; }
    .doc-meta .doc-title { font-size: 15px; font-weight: 800; color: ${BRAND_INK}; margin-bottom: 2px; }
    .doc-meta .doc-ref { font-family: "SF Mono", Menlo, monospace; color: #999; }

    .party-block { display: flex; justify-content: space-between; margin-bottom: 22px; gap: 24px; }
    .party { flex: 1; }
    .party .label { font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: #999; font-weight: 700; margin-bottom: 4px; }
    .party .name { font-size: 14px; font-weight: 800; color: ${BRAND_INK}; }
    .party .detail { font-size: 11px; color: #666; margin-top: 1px; }

    .summary { display: flex; gap: 16px; margin-bottom: 24px; }
    .summary .card {
      flex: 1;
      background: #fafafa;
      border: 1px solid #eee;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .summary .card.highlight { background: ${BRAND_RED}; }
    .summary .card .label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 700; }
    .summary .card.highlight .label { color: rgba(255,255,255,0.85); }
    .summary .card .value { font-size: 19px; font-weight: 900; margin-top: 4px; color: ${BRAND_INK}; }
    .summary .card.highlight .value { color: #fff; }

    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px; }
    thead th {
      text-align: left; padding: 8px; color: #999; text-transform: uppercase;
      font-size: 9px; letter-spacing: 0.5px; border-bottom: 2px solid ${BRAND_INK};
    }
    tbody td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: top; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .total-row td { border-top: 2px solid ${BRAND_INK}; border-bottom: none; font-weight: 900; padding-top: 12px; }

    .doc-footer {
      margin-top: 28px; padding-top: 14px; border-top: 1px solid #eee;
      font-size: 9.5px; color: #999; line-height: 1.6; text-align: center;
    }
    .doc-footer .company { font-weight: 800; color: #666; }
    .empty-note { color: #999; font-style: italic; padding: 16px 8px; text-align: center; }
  `;
}

export function brandHeader(docTitle: string, docRef: string, generatedAt: Date = new Date()): string {
  return `
    <div class="doc-header">
      <div>
        <div class="wordmark"><span class="r">R</span><span class="ide">ide</span></div>
        <div class="wordmark-sub">Ride-Hailing, Simplified</div>
      </div>
      <div class="doc-meta">
        <div class="doc-title">${docTitle}</div>
        <div>Generated ${generatedAt.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}</div>
        <div class="doc-ref">Ref: ${docRef}</div>
      </div>
    </div>
  `;
}

export function brandFooter(): string {
  return `
    <div class="doc-footer">
      <div class="company">RIDE (Pty) Ltd</div>
      <div>This is a system-generated document and does not require a signature.</div>
      <div>Questions about this document? Contact support from within the app.</div>
    </div>
  `;
}

// Short, human-scannable reference — not a formal invoice number, just
// enough to distinguish one export from another if a driver/rider emails
// support about a specific statement.
export function makeDocRef(prefix: string, periodStart: Date): string {
  const y = periodStart.getFullYear();
  const m = String(periodStart.getMonth() + 1).padStart(2, "0");
  const d = String(periodStart.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${y}${m}${d}-${rand}`;
}
