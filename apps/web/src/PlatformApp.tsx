import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  platformFetch,
  platformRequest,
  PlatformApiError,
  PLATFORM_SESSION_KEY
} from "./platform-api";

import "./platform.css";

type Row = { id: string;[key: string]: unknown };
type User = { id: string; email: string; displayName?: string | null };
type Plan = Row & { name: string; code: string; isActive: boolean };
type Subscription = Row & {
  status: string;
  plan: Plan;
  billingInterval?: string;
  priceSnapshot?: string;
  commissionRateSnapshot?: string;
  currency?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
};
type Merchant = Row & {
  name: string;
  currency?: string;
  phone?: string | null;
  alternatePhone?: string | null;
  address?: string | null;
  createdAt?: string;
  accountStatus: string;
  accountSuspensionReason?: string | null;
  accountSuspendedAt?: string | null;
  subscription: Subscription | null;
};
type View =
  | "Merchants"
  | "Billing Work"
  | "Plans"
  | "Overdue"
  | "Revenue"
  | "Audit";

type BillingWorkTab =
  | "draft"
  | "awaiting-payment"
  | "review"
  | "resolved";

type RevenueCurrencySummary = {
  currency: string;
  subscriptionAmount: string;
  commissionAmount: string;
  totalAmount: string;
};

type RevenuePeriodMode =
  | "month"
  | "year"
  | "custom";

type RevenuePeriodSummary = {
  periodStart: string;
  periodEnd: string;
  currencies: RevenueCurrencySummary[];
};

type OverdueCurrencySummary = {
  currency: string;
  invoiceCount: number;
  totalAmount: string;
};

type OverduePeriodSummary = {
  periodStart: string;
  periodEnd: string;
  currencies: OverdueCurrencySummary[];
};

function currentUtcMonth(): string {
  const now = new Date();

  return `${now.getUTCFullYear()}-${String(
    now.getUTCMonth() + 1
  ).padStart(2, "0")}`;
}

function revenueMonthRange(
  month: string
): {
  start: string;
  end: string;
} {
  const [year, monthNumber] =
    month.split("-").map(Number);

  const periodStart =
    new Date(
      Date.UTC(
        year,
        monthNumber - 1,
        1
      )
    );

  const periodEnd =
    new Date(
      Date.UTC(
        year,
        monthNumber,
        1
      )
    );

  return {
    start:
      periodStart
        .toISOString()
        .slice(0, 10),
    end:
      periodEnd
        .toISOString()
        .slice(0, 10)
  };
}

function revenueYearRange(
  year: string
): {
  start: string;
  end: string;
} {
  return {
    start: `${year}-01-01`,
    end: `${Number(year) + 1}-01-01`
  };
}

function nextUtcDate(
  date: string
): string {
  const next =
    new Date(
      `${date}T00:00:00.000Z`
    );

  next.setUTCDate(
    next.getUTCDate() + 1
  );

  return next
    .toISOString()
    .slice(0, 10);
}

type Field = { name: string; label: string; type?: string; optional?: boolean; options?: string[]; value?: unknown };
type Action = { title: string; path: string; method: string; fields: Field[]; note?: string; transform?: (values: Record<string, unknown>) => unknown };
const transitions: Record<string, string[]> = { TRIAL: ["ACTIVE", "CANCELLED"], ACTIVE: ["PAST_DUE", "CANCELLED"], PAST_DUE: ["ACTIVE", "SUSPENDED", "CANCELLED"], SUSPENDED: ["ACTIVE", "CANCELLED"], CANCELLED: [] };
const statuses = Object.keys(transitions);
const field = (name: string, label: string, type = "text", optional = false): Field => ({ name, label, type, optional });
const dateFields = (start: string, end: string): Field[] => [field(start, "Period start (local time)", "datetime-local"), field(end, "Period end (local time)", "datetime-local")];
const display = (value: unknown): string => value == null ? "—" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
const label = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());

function rowMerchantId(
  row: Row
): string {
  const merchant = row.merchant;

  return (
    merchant &&
    typeof merchant === "object" &&
    "id" in merchant &&
    typeof merchant.id === "string"
      ? merchant.id
      : ""
  );
}

function billingWorkRows(
  rows: Row[]
): Row[] {
  return rows.map(row => {
    const merchant = row.merchant;
    const invoice = row.invoice;

    const merchantName =
      merchant &&
      typeof merchant === "object" &&
      "name" in merchant &&
      typeof merchant.name === "string"
        ? merchant.name
        : "—";

    const invoiceNumber =
      invoice &&
      typeof invoice === "object" &&
      "invoiceNumber" in invoice &&
      typeof invoice.invoiceNumber === "string"
        ? invoice.invoiceNumber
        : typeof row.invoiceNumber === "string"
          ? row.invoiceNumber
          : "—";

    return {
      ...row,
      merchantName,
      invoiceNumber
    };
  });
}

function RecordModal({ row, close }: { row: Row; close: () => void }) {
  return <div className="pa-modal-backdrop" onMouseDown={close}><section className="pa-modal pa-record-modal" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}><div className="pa-modal-head"><div><p className="pa-eyebrow">FULL RECORD</p><h2>{String(row.name || row.invoiceNumber || row.id)}</h2></div><button type="button" className="pa-icon-button" onClick={close} aria-label="Close">×</button></div><dl className="pa-record-grid">{Object.entries(row).map(([k, v]) => <div key={k}><dt>{label(k)}</dt><dd>{typeof v === "object" && v !== null ? <pre>{JSON.stringify(v, null, 2)}</pre> : display(v)}</dd></div>)}</dl></section></div>;
}

function Table({ rows, columns, actions }: { rows: Row[]; columns: string[]; actions?: (row: Row) => ReactNode }) {
  const [record, setRecord] = useState<Row | null>(null);
  if (!rows.length) return <p className="pa-empty">No records found.</p>;
  return <><div className="pa-table"><table><thead><tr>{columns.map(c => <th key={c}>{label(c)}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map(c => <td key={c}>{display(row[c])}</td>)}<td><div className="pa-row-actions">{actions?.(row)}<button type="button" className="pa-link-button" onClick={() => setRecord(row)}>Full record</button></div></td></tr>)}</tbody></table></div>{record && <RecordModal row={record} close={() => setRecord(null)} />}</>;
}

function ActionForm({ action, busy, submit, close }: { action: Action; busy: boolean; submit: (body: unknown) => Promise<void>; close: () => void }) {
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const values: Record<string, unknown> = {};
      for (const f of action.fields) {
        const raw = String(data.get(f.name) ?? "").trim();
        if (!raw && f.optional) continue;
        values[f.name] = f.type === "datetime-local" ? new Date(raw).toISOString() : f.type === "json" ? JSON.parse(raw) : raw;
      }
      for (const [start, end] of [["periodStart", "periodEnd"], ["currentPeriodStart", "currentPeriodEnd"], ["billingPeriodStart", "billingPeriodEnd"]]) {
        if (values[start] && values[end] && String(values[start]) >= String(values[end])) throw new Error("Period end must be after period start.");
      }
      await submit(action.transform ? action.transform(values) : values);
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
  }
  return <div className="pa-modal-backdrop" onMouseDown={close}><section className="pa-modal pa-action-modal" role="dialog" aria-modal="true" aria-label={action.title} onMouseDown={e => e.stopPropagation()}><div className="pa-modal-head"><div><p className="pa-eyebrow">PLATFORM ACTION</p><h2>{action.title}</h2></div><button type="button" className="pa-icon-button" onClick={close} aria-label="Close">×</button></div><p>{action.note || "Review these details before submitting. The server validates this operation."}</p><form onSubmit={onSubmit}><fieldset disabled={busy}>{action.fields.map(f => <label key={f.name}>{f.label}{f.optional ? " (optional)" : ""}{f.options ? <select name={f.name} defaultValue={String(f.value ?? f.options[0])}>{f.options.map(v => <option key={v}>{v}</option>)}</select> : f.type === "json" ? <textarea name={f.name} required={!f.optional} defaultValue={f.value == null ? "" : JSON.stringify(f.value, null, 2)} /> : <input name={f.name} type={f.type || "text"} step="any" min={f.type === "number" ? "0" : undefined} required={!f.optional} defaultValue={f.value == null ? "" : String(f.value)} />}</label>)}{error && <p role="alert" className="pa-error">{error}</p>}<div className="pa-buttons"><button type="submit">{busy ? "Submitting…" : "Confirm and submit"}</button><button type="button" onClick={close}>Cancel</button></div></fieldset></form></section></div>;
}

export default function PlatformApp() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(PLATFORM_SESSION_KEY) || ""; } catch { return ""; } });
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!!token);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("Merchants");
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState("");
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [ledger, setLedger] = useState("invoices");
  const [billingWorkTab, setBillingWorkTab] =
    useState<BillingWorkTab>("review");
  const [rows, setRows] = useState<Row[]>([]);
  const [revenueSummary, setRevenueSummary] =
    useState<RevenuePeriodSummary | null>(null);
  const [revenuePeriodMode, setRevenuePeriodMode] =
    useState<RevenuePeriodMode>("month");
  const [revenueMonth, setRevenueMonth] =
    useState(currentUtcMonth);
  const [revenueYear, setRevenueYear] =
    useState(() =>
      String(new Date().getUTCFullYear())
    );
  const [revenueCustomStart, setRevenueCustomStart] =
    useState("");
  const [revenueCustomEnd, setRevenueCustomEnd] =
    useState("");
  const [overdueSummary, setOverdueSummary] =
    useState<OverduePeriodSummary | null>(null);
  const [overduePeriodMode, setOverduePeriodMode] =
    useState<RevenuePeriodMode>("month");
  const [overdueMonth, setOverdueMonth] =
    useState(currentUtcMonth);
  const [overdueYear, setOverdueYear] =
    useState(() =>
      String(new Date().getUTCFullYear())
    );
  const [overdueCustomStart, setOverdueCustomStart] =
    useState("");
  const [overdueCustomEnd, setOverdueCustomEnd] =
    useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [planFilter, setPlanFilter] = useState("ALL");
  const [billingFilter, setBillingFilter] = useState("ALL");
  const [createdFilter, setCreatedFilter] = useState("ALL");
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const session = useRef(0);
  function logout() {
    session.current++; try { sessionStorage.removeItem(PLATFORM_SESSION_KEY); } catch { /* Memory session still clears. */ }
    setToken(""); setUser(null); setChecking(false); setRows([]); setMerchants([]); setPlans([]); setMerchant(null); setSelected(""); setAction(null); setNotice(""); setBusy(false);
  }
  function fail(e: unknown) {
    if (e instanceof PlatformApiError && e.status === 401) logout();
    setError(e instanceof Error ? e.message : "Unable to connect to the API.");
  }
  async function openSettlementEvidence(
    settlement: Row
  ) {
    const receiptUrl =
      typeof settlement.receiptUrl === "string"
        ? settlement.receiptUrl.trim()
        : "";

    if (
      receiptUrl &&
      /^https?:\/\//i.test(receiptUrl)
    ) {
      window.open(
        receiptUrl,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }

    if (
      settlement.hasReceiptEvidence !== true
    ) {
      setError(
        "Settlement receipt evidence is not available."
      );
      return;
    }

    const merchantId =
      rowMerchantId(settlement) || selected;

    if (!merchantId) {
      setError(
        "Merchant information is not available for this settlement."
      );
      return;
    }

    const evidenceWindow =
      window.open("", "_blank");

    if (evidenceWindow) {
      evidenceWindow.opener = null;
    }

    try {
      setError("");

      const response =
        await platformFetch(
          `/merchants/${encodeURIComponent(
            merchantId
          )}/billing/settlements/${encodeURIComponent(
            settlement.id
          )}/evidence`,
          token
        );

      if (!response.ok) {
        const data =
          await response
            .json()
            .catch(() => null);

        throw new PlatformApiError(
          data?.error ||
            `Failed to load settlement evidence (${response.status})`,
          response.status
        );
      }

      const blob =
        await response.blob();

      const objectUrl =
        URL.createObjectURL(blob);

      if (evidenceWindow) {
        evidenceWindow.location.href =
          objectUrl;
      } else {
        const link =
          document.createElement("a");

        link.href = objectUrl;
        link.target = "_blank";
        link.rel =
          "noopener noreferrer";

        document.body.appendChild(
          link
        );

        link.click();
        link.remove();
      }

      window.setTimeout(
        () => {
          URL.revokeObjectURL(
            objectUrl
          );
        },
        60_000
      );
    } catch (e) {
      evidenceWindow?.close();
      fail(e);
    }
  }
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController(); setChecking(true);
    platformRequest<{ user: User }>("/auth/me", token, "GET", undefined, controller.signal).then(data => { setUser(data.user); setChecking(false); }).catch(e => { if (!controller.signal.aborted) { fail(e); setChecking(false); } });
    return () => controller.abort();
  }, [token, revision]);
  useEffect(() => {
    if (!user || !token) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setRows([]); setMerchant(null); setRevenueSummary(null); setOverdueSummary(null);
    async function load() {
      const [m, p] = await Promise.all([
        platformRequest<{ merchants: Merchant[] }>("/merchants", token, "GET", undefined, controller.signal),
        platformRequest<{ plans: Plan[] }>("/plans", token, "GET", undefined, controller.signal)
      ]);
      let data: Row[] = []; let detail: Merchant | null = null;
      if (view === "Merchants" && selected) {
        const [d, history] = await Promise.all([
          platformRequest<{ merchant: Merchant }>(`/merchants/${encodeURIComponent(selected)}`, token, "GET", undefined, controller.signal),
          platformRequest<Record<string, Row[]>>(`/merchants/${encodeURIComponent(selected)}/billing/${ledger}`, token, "GET", undefined, controller.signal)
        ]);
        detail = d.merchant;
        data = history[ledger];
      } else if (view === "Billing Work") {
        const billingWorkRoutes: Record<
          BillingWorkTab,
          {
            path: string;
            key: "invoices" | "settlements";
          }
        > = {
          draft: {
            path: "/billing/invoices/draft",
            key: "invoices"
          },
          "awaiting-payment": {
            path: "/billing/invoices/awaiting-payment",
            key: "invoices"
          },
          review: {
            path: "/billing/settlements/review",
            key: "settlements"
          },
          resolved: {
            path: "/billing/settlements/resolved",
            key: "settlements"
          }
        };

        const route =
          billingWorkRoutes[billingWorkTab];

        const result =
          await platformRequest<
            Record<string, Row[]>
          >(
            route.path,
            token,
            "GET",
            undefined,
            controller.signal
          );

        data = result[route.key];
      } else if (view === "Revenue") {
        let range: {
          start: string;
          end: string;
        } | null = null;

        if (revenuePeriodMode === "month") {
          range =
            revenueMonthRange(
              revenueMonth
            );
        } else if (
          revenuePeriodMode === "year"
        ) {
          range =
            revenueYearRange(
              revenueYear
            );
        } else if (
          revenueCustomStart &&
          revenueCustomEnd
        ) {
          range = {
            start: revenueCustomStart,
            end:
              nextUtcDate(
                revenueCustomEnd
              )
          };
        }

        const revenue =
          await platformRequest<{
            invoices: Row[];
          }>(
            "/billing/revenue",
            token,
            "GET",
            undefined,
            controller.signal
          );

        data = revenue.invoices;

        if (range) {
          const summary =
            await platformRequest<RevenuePeriodSummary>(
              `/billing/revenue/range-summary?start=${encodeURIComponent(
                range.start
              )}&end=${encodeURIComponent(
                range.end
              )}`,
              token,
              "GET",
              undefined,
              controller.signal
            );

          if (!controller.signal.aborted) {
            setRevenueSummary(summary);
          }
        }
      } else if (view === "Overdue") {
        let range: {
          start: string;
          end: string;
        } | null = null;

        if (overduePeriodMode === "month") {
          range =
            revenueMonthRange(
              overdueMonth
            );
        } else if (
          overduePeriodMode === "year"
        ) {
          range =
            revenueYearRange(
              overdueYear
            );
        } else if (
          overdueCustomStart &&
          overdueCustomEnd
        ) {
          range = {
            start: overdueCustomStart,
            end:
              nextUtcDate(
                overdueCustomEnd
              )
          };
        }

        if (range) {
          const [summary, overdue] =
            await Promise.all([
              platformRequest<OverduePeriodSummary>(
                `/billing/overdue/range-summary?start=${encodeURIComponent(
                  range.start
                )}&end=${encodeURIComponent(
                  range.end
                )}`,
                token,
                "GET",
                undefined,
                controller.signal
              ),
              platformRequest<{
                invoices: Row[];
              }>(
                `/billing/overdue/range?start=${encodeURIComponent(
                  range.start
                )}&end=${encodeURIComponent(
                  range.end
                )}`,
                token,
                "GET",
                undefined,
                controller.signal
              )
            ]);

          data = overdue.invoices;

          if (!controller.signal.aborted) {
            setOverdueSummary(summary);
          }
        }
      } else if (view === "Audit") {
        const result =
          await platformRequest<{
            auditLogs: Row[];
          }>(
            "/audit",
            token,
            "GET",
            undefined,
            controller.signal
          );

        data = result.auditLogs;
      }
      if (!controller.signal.aborted) { setMerchants(m.merchants); setPlans(p.plans); setMerchant(detail); setRows(data); setLoading(false); }
    }
    load().catch(e => { if (!controller.signal.aborted) { fail(e); setLoading(false); } });
    return () => controller.abort();
  }, [
    user,
    token,
    view,
    selected,
    ledger,
    billingWorkTab,
    revenuePeriodMode,
    revenueMonth,
    revenueYear,
    revenueCustomStart,
    revenueCustomEnd,
    overduePeriodMode,
    overdueMonth,
    overdueYear,
    overdueCustomStart,
    overdueCustomEnd,
    revision
  ]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const result = await platformRequest<{ token: string }>("/auth/login", "", "POST", { email: data.get("email"), password: data.get("password") });
      try { sessionStorage.setItem(PLATFORM_SESSION_KEY, result.token); } catch { /* Allow an in-memory session when storage is unavailable. */ }
      setToken(result.token);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function submit(body: unknown) {
    if (!action || busy) return;
    const generation = session.current; setBusy(true); setError(""); setNotice("");
    try {
      await platformRequest(action.path, token, action.method, body);
      if (generation === session.current) { setAction(null); setNotice("Operation completed. Records refreshed from the server."); setRevision(v => v + 1); }
    } catch (e) { if (generation === session.current) fail(e); throw e; }
    finally { if (generation === session.current) setBusy(false); }
  }
  function planAction(plan?: Plan) {
    const fields = [...(plan ? [] : [field("code", "Plan code")]), field("name", "Name"), field("monthlyPrice", "Monthly price", "number"), field("annualPrice", "Annual price", "number"), field("currency", "Currency (3-letter code)"), field("commissionRate", "Commission rate (decimal, e.g. 0.05 = 5%)", "number"), field("features", "Features (JSON)", "json", true)].map(f => ({ ...f, value: plan?.[f.name] }));
    setAction({ title: plan ? `Edit ${plan.name}` : "Create plan", path: plan ? `/plans/${encodeURIComponent(plan.id)}` : "/plans", method: plan ? "PATCH" : "POST", fields, note: "Existing subscription price and commission snapshots remain governed by the backend." });
  }
  const merchantPath = `/merchants/${encodeURIComponent(selected)}`;
  if (!user) return <main className="pa-root"><section className="pa-login pa-card"><p className="pa-eyebrow">ETHIO COMMERCE / PLATFORM</p><h1>Platform administration</h1><p>Sign in with your platform operator account.</p>{error && <p role="alert" className="pa-error">{error}</p>}{checking ? <p role="status">Validating platform session…</p> : <form onSubmit={login}><fieldset disabled={busy}><label>Email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button>{busy ? "Signing in…" : "Sign in"}</button></fieldset></form>}{token && !checking && <button onClick={logout}>Clear session and sign in again</button>}<p><a href="/">Merchant dashboard</a></p></section></main>;
  return <div className="pa-root"><header className="pa-header"><div><p className="pa-eyebrow">ETHIO COMMERCE</p><h1>Platform administration</h1></div><div>{user.displayName || user.email}<div className="pa-buttons"><a href="/">Merchant dashboard</a><button onClick={logout}>Sign out</button></div></div></header><nav aria-label="Platform sections">{([
    "Merchants",
    "Billing Work",
    "Revenue",
    "Overdue",
    "Plans",
    "Audit"
  ] as View[]).map(v => <button key={v} aria-current={view === v ? "page" : undefined} disabled={busy} onClick={() => { setView(v); setSelected(""); setAction(null); setSearch(""); }}>{v}</button>)}</nav><main>
    {view === "Merchants" && selected ? <div className="pa-detail-header"><button className="pa-back-button" onClick={() => { setSelected(""); setAction(null); setRows([]); }}>← Back to merchants</button><button disabled={busy || loading} onClick={() => setRevision(v => v + 1)}>Refresh</button></div> : <div className="pa-title"><div><h2>{view}</h2><p>{view === "Revenue" ? "Paid invoices, as recorded by the server. Amounts retain their original currency." : view === "Overdue" ? "Invoices marked OVERDUE by the server." : view === "Audit" ? "Latest 100 platform audit entries." : "Manage platform accounts and billing."}</p></div><button disabled={busy || loading} onClick={() => setRevision(v => v + 1)}>Refresh</button></div>}
    {error && <p role="alert" className="pa-error">{error}</p>}{notice && <p role="status" className="pa-success">{notice}</p>}{action && <ActionForm key={action.title + action.path} action={action} busy={busy} submit={submit} close={() => setAction(null)} />}
    {loading ? <p role="status">Loading records…</p> : error ? <p>Use Refresh to retry loading current records.</p> : <>
      {view === "Merchants" && !selected && <>
        <div className="pa-merchant-toolbar">
          <label className="pa-search">Find a merchant<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, ID, phone, address, status or plan" /></label>
          <label>Status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="ALL">All statuses</option><option value="NO_SUBSCRIPTION">No subscription</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
          <label>Plan<select value={planFilter} onChange={e => setPlanFilter(e.target.value)}><option value="ALL">All plans</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
          <label>Billing<select value={billingFilter} onChange={e => setBillingFilter(e.target.value)}><option value="ALL">All intervals</option><option value="MONTHLY">MONTHLY</option><option value="ANNUAL">ANNUAL</option><option value="NONE">No subscription</option></select></label>
          <label>Opened<select value={createdFilter} onChange={e => setCreatedFilter(e.target.value)}><option value="ALL">Any time</option><option value="TODAY">Today</option><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option></select></label>
        </div>
        <div className="pa-filter-summary"><span>{merchants.filter(m => {
          const textMatch = `${m.name} ${m.id} ${m.phone || ""} ${m.alternatePhone || ""} ${m.address || ""} ${m.subscription?.status || ""} ${m.subscription?.plan?.name || ""}`.toLowerCase().includes(search.toLowerCase());
          const statusMatch = statusFilter === "ALL" || (statusFilter === "NO_SUBSCRIPTION" ? !m.subscription : m.subscription?.status === statusFilter);
          const planMatch = planFilter === "ALL" || m.subscription?.plan?.id === planFilter;
          const billingMatch = billingFilter === "ALL" || (billingFilter === "NONE" ? !m.subscription : m.subscription?.billingInterval === billingFilter);
          let createdMatch = true;
          if (createdFilter !== "ALL") {
            if (!m.createdAt) createdMatch = false;
            else {
              const created = new Date(m.createdAt).getTime();
              const now = Date.now();
              const day = 24 * 60 * 60 * 1000;
              createdMatch = createdFilter === "TODAY" ? new Date(m.createdAt).toDateString() === new Date().toDateString() : created >= now - (createdFilter === "7D" ? 7 : 30) * day;
            }
          }
          return textMatch && statusMatch && planMatch && billingMatch && createdMatch;
        }).length} of {merchants.length} merchants</span><button type="button" className="pa-link-button" onClick={() => { setSearch(""); setStatusFilter("ALL"); setPlanFilter("ALL"); setBillingFilter("ALL"); setCreatedFilter("ALL"); }}>Clear filters</button></div>
        <div className="pa-table"><table><thead><tr><th>Merchant</th><th>Subscription</th><th>Plan</th><th>Billing</th><th>Current period</th><th>Opened</th><th>Currency</th><th>Action</th></tr></thead><tbody>{merchants.filter(m => {
          const textMatch = `${m.name} ${m.id} ${m.phone || ""} ${m.alternatePhone || ""} ${m.address || ""} ${m.subscription?.status || ""} ${m.subscription?.plan?.name || ""}`.toLowerCase().includes(search.toLowerCase());
          const statusMatch = statusFilter === "ALL" || (statusFilter === "NO_SUBSCRIPTION" ? !m.subscription : m.subscription?.status === statusFilter);
          const planMatch = planFilter === "ALL" || m.subscription?.plan?.id === planFilter;
          const billingMatch = billingFilter === "ALL" || (billingFilter === "NONE" ? !m.subscription : m.subscription?.billingInterval === billingFilter);
          let createdMatch = true;
          if (createdFilter !== "ALL") {
            if (!m.createdAt) createdMatch = false;
            else {
              const created = new Date(m.createdAt).getTime();
              const now = Date.now();
              const day = 24 * 60 * 60 * 1000;
              createdMatch = createdFilter === "TODAY" ? new Date(m.createdAt).toDateString() === new Date().toDateString() : created >= now - (createdFilter === "7D" ? 7 : 30) * day;
            }
          }
          return textMatch && statusMatch && planMatch && billingMatch && createdMatch;
        }).map(m => <tr key={m.id}><td><strong>{m.name}</strong><span className="pa-subtle pa-code">{m.id}</span></td><td><span className={`pa-status pa-status-${String(m.subscription?.status || "none").toLowerCase().replace(/_/g, "-")}`}>{m.subscription?.status || "No subscription"}</span></td><td>{m.subscription?.plan?.name || "—"}<span className="pa-subtle">{m.subscription?.plan?.code || ""}</span></td><td>{display(m.subscription?.billingInterval)}<span className="pa-subtle">{display(m.subscription?.priceSnapshot)} {m.subscription?.currency || m.currency || ""}</span></td><td>{m.subscription?.currentPeriodStart ? new Date(String(m.subscription.currentPeriodStart)).toLocaleDateString() : "—"}<span className="pa-subtle">to {m.subscription?.currentPeriodEnd ? new Date(String(m.subscription.currentPeriodEnd)).toLocaleDateString() : "—"}</span></td><td>{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}</td><td>{m.currency || m.subscription?.currency || "—"}</td><td><button disabled={busy} onClick={() => { setSelected(m.id); setLedger("invoices"); setAction(null); }}>Manage</button></td></tr>)}</tbody></table></div></>}
      {view === "Merchants" && selected && merchant && <section className="pa-merchant-detail"><div className="pa-merchant-hero"><div><p className="pa-eyebrow">MERCHANT ACCOUNT</p><h2>{merchant.name}</h2><p className="pa-code">{merchant.id}</p></div><span className={`pa-status pa-status-${String(merchant.subscription?.status || "none").toLowerCase().replace(/_/g, "-")}`}>{merchant.subscription?.status || "No subscription"}</span></div><section className="pa-card"><div className="pa-section-heading"><div><h3>Subscription</h3><p>Current server-authoritative subscription snapshot.</p></div>{merchant.subscription && !!transitions[merchant.subscription.status]?.length && <button disabled={busy} onClick={() => setAction({ title: `Change subscription status — ${merchant.name}`, path: `${merchantPath}/subscription/status`, method: "PATCH", fields: [{ name: "nextStatus", label: "Next status", options: transitions[merchant.subscription!.status] }] })}>Change status</button>}</div>{merchant.subscription ? <div className="pa-metric-grid"><div><span>Status</span><strong>{merchant.subscription.status}</strong></div><div><span>Plan</span><strong>{merchant.subscription.plan.name}</strong><small>{merchant.subscription.plan.code}</small></div><div><span>Billing interval</span><strong>{display(merchant.subscription.billingInterval)}</strong></div><div><span>Price snapshot</span><strong>{display(merchant.subscription.priceSnapshot)} {merchant.subscription.currency || ""}</strong></div><div><span>Commission rate</span><strong>{merchant.subscription.commissionRateSnapshot == null ? "—" : `${Number(merchant.subscription.commissionRateSnapshot) * 100}%`}</strong></div><div><span>Currency</span><strong>{merchant.subscription.currency || merchant.currency || "—"}</strong></div><div><span>Period start</span><strong>{merchant.subscription.currentPeriodStart ? new Date(String(merchant.subscription.currentPeriodStart)).toLocaleDateString() : "—"}</strong></div><div><span>Period end</span><strong>{merchant.subscription.currentPeriodEnd ? new Date(String(merchant.subscription.currentPeriodEnd)).toLocaleDateString() : "—"}</strong></div></div> : <><p>No subscription.</p><button disabled={busy || !plans.some(p => p.isActive)} onClick={() => setAction({ title: `Initialize subscription — ${merchant.name}`, path: `${merchantPath}/subscription`, method: "POST", fields: [{ name: "planId", label: "Plan ID", options: plans.filter(p => p.isActive).map(p => p.id) }, { name: "billingInterval", label: "Billing interval", options: ["MONTHLY", "ANNUAL"] }, { name: "status", label: "Initial status", options: statuses }, ...dateFields("currentPeriodStart", "currentPeriodEnd"), field("trialEndsAt", "Trial end (local time)", "datetime-local", true)] })}>Initialize subscription</button></>}</section>

<section className="pa-card">
  <div className="pa-section-heading">
    <div>
      <h3>Account status</h3>
      <p>
        Platform account enforcement, separate from billing subscription status.
      </p>
    </div>

    {merchant.accountStatus === "ACTIVE" && (
      <button
        disabled={busy}
        onClick={() =>
          setAction({
            title: `Suspend account — ${merchant.name}`,
            path: `${merchantPath}/account/status`,
            method: "PATCH",
            fields: [
              { name: "reason", label: "Reason" }
            ],
            transform: values => ({
              ...values,
              nextStatus: "SUSPENDED"
            })
          })
        }
      >
        Suspend account
      </button>
    )}

    {merchant.accountStatus === "SUSPENDED" && (
      <button
        disabled={busy}
        onClick={() =>
          setAction({
            title: `Reinstate account — ${merchant.name}`,
            path: `${merchantPath}/account/status`,
            method: "PATCH",
            fields: [
              { name: "reason", label: "Reason" }
            ],
            transform: values => ({
              ...values,
              nextStatus: "ACTIVE"
            })
          })
        }
      >
        Reinstate account
      </button>
    )}
  </div>

  <div className="pa-metric-grid">
    <div>
      <span>Status</span>
      <strong>{merchant.accountStatus}</strong>
    </div>

    {merchant.accountStatus === "SUSPENDED" && (
      <>
        <div>
          <span>Suspension reason</span>
          <strong>
            {merchant.accountSuspensionReason || "—"}
          </strong>
        </div>
        <div>
          <span>Suspended at</span>
          <strong>
            {merchant.accountSuspendedAt
              ? new Date(
                  merchant.accountSuspendedAt
                ).toLocaleString()
              : "—"}
          </strong>
        </div>
      </>
    )}
  </div>
</section>

<section className="pa-card">  <div className="pa-section-heading">    <div>      <h3>Merchant Contact</h3>      <p>Business contact information maintained by the merchant.</p>    </div>  </div>  <div className="pa-metric-grid">    <div><span>Phone</span><strong>{merchant.phone || "-"}</strong></div>    <div><span>Alternate phone</span><strong>{merchant.alternatePhone || "-"}</strong></div>    <div><span>Address</span><strong>{merchant.address || "-"}</strong></div>  </div></section><section className="pa-card"><div className="pa-section-heading"><div><h3>Billing</h3><p>Invoices, commissions and settlement evidence.</p></div>{ledger === "invoices" && <button disabled={busy} onClick={() => setAction({ title: `Generate draft invoice — ${merchant.name}`, path: `${merchantPath}/billing/invoices`, method: "POST", note: "Enter the invoice period explicitly. To include a subscription charge, supply all three optional subscription fields. Totals are calculated and persisted by the server.", fields: [field("invoiceNumber", "Invoice number"), ...dateFields("periodStart", "periodEnd"), field("dueAt", "Due date (local time)", "datetime-local", true), field("subscriptionId", "Subscription ID", "text", true), ...dateFields("billingPeriodStart", "billingPeriodEnd").map(f => ({ ...f, optional: true }))], transform: values => { const { subscriptionId, billingPeriodStart, billingPeriodEnd, ...rest } = values; if (subscriptionId || billingPeriodStart || billingPeriodEnd) { if (!subscriptionId || !billingPeriodStart || !billingPeriodEnd) throw new Error("Supply subscription ID and both subscription billing dates."); return { ...rest, subscriptionCharge: { subscriptionId, billingPeriodStart, billingPeriodEnd } }; } return rest; } })}>Generate draft invoice</button>}</div><div className="pa-tabs">{["invoices", "commissions", "settlements"].map(v => <button key={v} disabled={busy} aria-pressed={ledger === v} onClick={() => { setLedger(v); setAction(null); }}>{label(v)}</button>)}</div><Table rows={rows} columns={ledger === "invoices" ? ["invoiceNumber", "status", "totalAmount", "currency", "dueAt"] : ledger === "commissions" ? ["orderId", "commissionAmount", "adjustmentAmount", "netCommissionAmount", "currency", "status"] : ["invoiceId", "amount", "currency", "status", "transactionReference"]} actions={r => <>{ledger === "invoices" && r.status === "DRAFT" && <button disabled={busy} onClick={() => setAction({ title: `Open invoice ${r.invoiceNumber}`, path: `${merchantPath}/billing/invoices/${encodeURIComponent(r.id)}/open`, method: "POST", fields: [], note: `Open persisted invoice for ${r.totalAmount} ${r.currency}?` })}>Open invoice</button>}{ledger === "settlements" && <>{(
  r.hasReceiptEvidence === true ||
  (
    typeof r.receiptUrl === "string" &&
    /^https?:\/\//i.test(
      r.receiptUrl
    )
  )
) && (
  <button
    type="button"
    disabled={busy}
    onClick={() =>
      void openSettlementEvidence(
        r
      )
    }
  >
    View receipt
  </button>
)}{r.status === "REVIEW_REQUIRED" && ["verify", "reject"].map(v => <button key={v} disabled={busy} onClick={() => setAction({ title: `${label(v)} settlement ${r.id}`, path: `${merchantPath}/billing/settlements/${encodeURIComponent(r.id)}/${v}`, method: "POST", fields: [field("reviewNote", "Review note", "text", true)], note: `${label(v)} evidence for ${r.amount} ${r.currency}, invoice ${r.invoiceId}. Verification can mark the associated OPEN invoice paid; the server enforces eligibility.` })}>{label(v)}</button>)}</>}</>} /></section></section>}
      {view === "Billing Work" && (
  <>
    <div className="pa-tabs">
      {(
        [
          ["draft", "Draft Invoices"],
          [
            "awaiting-payment",
            "Awaiting Payment"
          ],
          ["review", "Payment Review"],
          ["resolved", "Resolved"]
        ] as [
          BillingWorkTab,
          string
        ][]
      ).map(([tab, text]) => (
        <button
          key={tab}
          type="button"
          disabled={busy}
          aria-pressed={
            billingWorkTab === tab
          }
          onClick={() => {
            setBillingWorkTab(tab);
            setAction(null);
          }}
        >
          {text}
        </button>
      ))}
    </div>

    {(billingWorkTab === "draft" ||
      billingWorkTab ===
        "awaiting-payment") && (
<Table
  rows={billingWorkRows(rows)}
  columns={[
    "invoiceNumber",
    "merchantName",
    "totalAmount",
    "currency",
    "status",
    billingWorkTab === "draft"
      ? "createdAt"
      : "openedAt"
  ]}
  actions={r => {
    const merchantId =
      rowMerchantId(r);

    if (
      billingWorkTab !== "draft" ||
      r.status !== "DRAFT" ||
      !merchantId
    ) {
      return null;
    }

    return (
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          setAction({
            title:
              `Open invoice ${r.invoiceNumber}`,
            path:
              `/merchants/${encodeURIComponent(
                merchantId
              )}/billing/invoices/${encodeURIComponent(
                r.id
              )}/open`,
            method: "POST",
            fields: [],
            note:
              `Open invoice ${r.invoiceNumber} for ${r.totalAmount} ${r.currency}. The server enforces invoice lifecycle eligibility.`
          })
        }
      >
        Open invoice
      </button>
    );
  }}
/>
    )}

    {(billingWorkTab === "review" ||
      billingWorkTab === "resolved") && (
<Table
  rows={billingWorkRows(rows)}
  columns={[
    "merchantName",
    "invoiceNumber",
    "amount",
    "currency",
    "status",
    "provider",
    "transactionReference",
    billingWorkTab === "review"
      ? "submittedAt"
      : "verifiedAt"
  ]}
  actions={r => {
    const merchantId =
      rowMerchantId(r);

    const hasReceipt =
      r.hasReceiptEvidence === true ||
      (
        typeof r.receiptUrl ===
          "string" &&
        /^https?:\/\//i.test(
          r.receiptUrl
        )
      );

    return (
      <>
        {hasReceipt && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void openSettlementEvidence(
                r
              )
            }
          >
            View receipt
          </button>
        )}

        {billingWorkTab === "review" &&
          r.status ===
            "REVIEW_REQUIRED" &&
          merchantId &&
          ["verify", "reject"].map(
            operation => (
              <button
                key={operation}
                type="button"
                disabled={busy}
                onClick={() =>
                  setAction({
                    title:
                      `${label(
                        operation
                      )} settlement ${r.id}`,
                    path:
                      `/merchants/${encodeURIComponent(
                        merchantId
                      )}/billing/settlements/${encodeURIComponent(
                        r.id
                      )}/${operation}`,
                    method: "POST",
                    fields: [
                      field(
                        "reviewNote",
                        "Review note",
                        "text",
                        true
                      )
                    ],
                    note:
                      `${label(
                        operation
                      )} evidence for ${r.amount} ${r.currency}, invoice ${r.invoiceId}. Verification can mark the associated OPEN invoice paid; the server enforces eligibility.`
                  })
                }
              >
                {label(operation)}
              </button>
            )
          )}
      </>
    );
  }}
/>
    )}
  </>
)}{view === "Plans" && <><button disabled={busy} onClick={() => planAction()}>Create plan</button><Table rows={plans} columns={["name", "code", "monthlyPrice", "annualPrice", "currency", "commissionRate", "isActive"]} actions={r => <><button disabled={busy} onClick={() => planAction(r as Plan)}>Edit</button><button disabled={busy} onClick={() => setAction({ title: `${r.isActive ? "Deactivate" : "Activate"} ${r.name}`, path: `/plans/${encodeURIComponent(r.id)}/active-state`, method: "PATCH", fields: [], transform: () => ({ isActive: !r.isActive }) })}>{r.isActive ? "Deactivate" : "Activate"}</button></>} /></>}
      {view === "Revenue" && (
        <>
      <section className="pa-card">
        <div className="pa-section-heading">
          <div>
            <h3>Collected revenue</h3>
            <p>
              Review paid invoice revenue for a selected UTC period.
              Amounts remain separated by currency.
            </p>
          </div>
        </div>

        <div className="pa-tabs">
          <button
            type="button"
            className={
              revenuePeriodMode === "month"
                ? "active"
                : ""
            }
            onClick={() =>
              setRevenuePeriodMode("month")
            }
          >
            Month
          </button>

          <button
            type="button"
            className={
              revenuePeriodMode === "year"
                ? "active"
                : ""
            }
            onClick={() =>
              setRevenuePeriodMode("year")
            }
          >
            Year
          </button>

          <button
            type="button"
            className={
              revenuePeriodMode === "custom"
                ? "active"
                : ""
            }
            onClick={() =>
              setRevenuePeriodMode("custom")
            }
          >
            Custom range
          </button>
        </div>

        {revenuePeriodMode === "month" && (
          <label>
            Month
            <input
              type="month"
              value={revenueMonth}
              onChange={event =>
                setRevenueMonth(
                  event.target.value
                )
              }
            />
          </label>
        )}

        {revenuePeriodMode === "year" && (
          <label>
            Year
            <input
              type="number"
              min="2000"
              max="2100"
              value={revenueYear}
              onChange={event =>
                setRevenueYear(
                  event.target.value
                )
              }
            />
          </label>
        )}

        {revenuePeriodMode === "custom" && (
          <div className="pa-form-grid">
            <label>
              From
              <input
                type="date"
                value={revenueCustomStart}
                onChange={event =>
                  setRevenueCustomStart(
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Through
              <input
                type="date"
                value={revenueCustomEnd}
                min={
                  revenueCustomStart ||
                  undefined
                }
                onChange={event =>
                  setRevenueCustomEnd(
                    event.target.value
                  )
                }
              />
            </label>
          </div>
        )}

        {revenueSummary &&
        revenueSummary.currencies.length > 0 ? (
          <div className="pa-metric-grid">
            {revenueSummary.currencies.map(
              summary => (
                <div key={summary.currency}>
                  <span>{summary.currency}</span>
                  <strong>
                    Collected total:{" "}
                    {summary.totalAmount}{" "}
                    {summary.currency}
                  </strong>
                  <small>
                    Collected subscription:{" "}
                    {summary.subscriptionAmount}{" "}
                    {summary.currency}
                  </small>
                  <small>
                    Collected commission:{" "}
                    {summary.commissionAmount}{" "}
                    {summary.currency}
                  </small>
                </div>
              )
            )}
          </div>
        ) : (
          <p className="pa-empty">
            {revenuePeriodMode === "custom" &&
            (!revenueCustomStart ||
              !revenueCustomEnd)
              ? "Choose both dates to view collected revenue."
              : "No collected revenue for the selected period."}
          </p>
        )}
      </section>

          <Table
            rows={rows}
            columns={[
              "invoiceNumber",
              "merchant",
              "totalAmount",
              "currency",
              "status",
              "paidAt"
            ]}
          />
        </>
      )}

      {view === "Overdue" && (
        <>
          <section className="pa-card">
            <div className="pa-section-heading">
              <div>
                <h3>Overdue invoices</h3>
                <p>
                  Review invoices currently marked OVERDUE for a selected UTC period.
                  Amounts remain separated by currency.
                </p>
              </div>
            </div>

            <div className="pa-tabs">
              <button
                type="button"
                className={
                  overduePeriodMode === "month"
                    ? "active"
                    : ""
                }
                onClick={() =>
                  setOverduePeriodMode("month")
                }
              >
                Month
              </button>

              <button
                type="button"
                className={
                  overduePeriodMode === "year"
                    ? "active"
                    : ""
                }
                onClick={() =>
                  setOverduePeriodMode("year")
                }
              >
                Year
              </button>

              <button
                type="button"
                className={
                  overduePeriodMode === "custom"
                    ? "active"
                    : ""
                }
                onClick={() =>
                  setOverduePeriodMode("custom")
                }
              >
                Custom range
              </button>
            </div>

            {overduePeriodMode === "month" && (
              <label>
                Month
                <input
                  type="month"
                  value={overdueMonth}
                  onChange={event =>
                    setOverdueMonth(
                      event.target.value
                    )
                  }
                />
              </label>
            )}

            {overduePeriodMode === "year" && (
              <label>
                Year
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  value={overdueYear}
                  onChange={event =>
                    setOverdueYear(
                      event.target.value
                    )
                  }
                />
              </label>
            )}

            {overduePeriodMode === "custom" && (
              <div className="pa-form-grid">
                <label>
                  From
                  <input
                    type="date"
                    value={overdueCustomStart}
                    onChange={event =>
                      setOverdueCustomStart(
                        event.target.value
                      )
                    }
                  />
                </label>

                <label>
                  Through
                  <input
                    type="date"
                    value={overdueCustomEnd}
                    min={
                      overdueCustomStart ||
                      undefined
                    }
                    onChange={event =>
                      setOverdueCustomEnd(
                        event.target.value
                      )
                    }
                  />
                </label>
              </div>
            )}

            {overdueSummary &&
            overdueSummary.currencies.length > 0 ? (
              <div className="pa-metric-grid">
                {overdueSummary.currencies.map(
                  summary => (
                    <div key={summary.currency}>
                      <span>{summary.currency}</span>
                      <strong>
                        Overdue total:{" "}
                        {summary.totalAmount}{" "}
                        {summary.currency}
                      </strong>
                      <small>
                        Invoice count:{" "}
                        {summary.invoiceCount}
                      </small>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="pa-empty">
                {overduePeriodMode === "custom" &&
                (!overdueCustomStart ||
                  !overdueCustomEnd)
                  ? "Choose both dates to view overdue invoices."
                  : "No overdue invoices for the selected period."}
              </p>
            )}
          </section>

          <Table
            rows={rows}
            columns={[
              "invoiceNumber",
              "merchant",
              "totalAmount",
              "currency",
              "status",
              "dueAt"
            ]}
          />
        </>
      )}
      {view === "Audit" && <Table rows={rows} columns={["createdAt", "actor", "action", "entityType", "entityId"]} />}
    </>}</main></div>;
}
