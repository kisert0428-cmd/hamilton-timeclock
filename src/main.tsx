import {
  punchTimeFields,
  punchTimeChoices,
  correctionTimePayload,
  type Occurrence,
} from "../shared/punch-time";
import { readPunchLocation, locationLabels } from "./location";
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Clock3,
  LayoutDashboard,
  Users,
  CalendarDays,
  Download,
  Settings,
  ArrowUpRight,
  ArrowRight,
  LogIn,
  LogOut,
  Coffee,
  Sun,
  ShieldCheck,
  MapPin,
  Check,
  Delete,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Monitor,
  Plus,
  AlertCircle,
  LockKeyhole,
  Building2,
  RefreshCw,
} from "lucide-react";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./style.css";
const zone = "America/New_York";
const names: any = {
  in: "Clock in",
  lunch_out: "Start lunch",
  lunch_in: "End lunch",
  out: "Clock out",
};
async function api(path: string, options: any = {}) {
  const r = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Request failed");
  return data;
}
const send = (path: string, data: any, method = "POST") =>
  api(path, { method, body: JSON.stringify(data) });
const dateNY = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const time = (d: any) =>
  d
    ? new Date(d).toLocaleTimeString("en-US", {
        timeZone: zone,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
const hours = (n: number) => Number(n || 0).toFixed(2);
function App() {
  const [view, setView] = useState(
      location.pathname === "/setup"
        ? "setup"
        : location.pathname === "/admin"
          ? "overview"
          : "clock",
    ),
    [me, setMe] = useState<any>(null),
    [config, setConfig] = useState<any>({}),
    [now, setNow] = useState(new Date()),
    [mobile, setMobile] = useState(false),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<any>(null),
    [week, setWeek] = useState(dateNY()),
    [report, setReport] = useState<any>(null),
    [employees, setEmployees] = useState<any[]>([]),
    [locationData, setLocationData] = useState<any>(null),
    [refresh, setRefresh] = useState(0);
  const notify = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 6000);
  };
  const clockAnchor = useRef({ server: Date.now(), mono: performance.now() });
  useEffect(() => {
    api("/config")
      .then((c) => {
        setConfig(c);
        clockAnchor.current = {
          server: Date.parse(c.serverTime),
          mono: performance.now(),
        };
        setNow(new Date(c.serverTime));
        setWeek(dateNY(new Date(c.serverTime)));
      })
      .catch(() =>
        notify(
          "Server is unavailable. Punches cannot be saved until reconnected.",
        ),
      );
    api("/me")
      .then(setMe)
      .catch(() => {});
    const t = setInterval(
      () =>
        setNow(
          new Date(
            clockAnchor.current.server +
              performance.now() -
              clockAnchor.current.mono,
          ),
        ),
      1000,
    );
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (me && view !== "clock") {
      Promise.all([
        api("/report?week=" + week),
        api("/employees"),
        api("/location-reviews"),
      ])
        .then(([r, e, l]) => {
          setLocationData(l);
          setReport(r);
          setEmployees(e);
        })
        .catch((e) => notify(e.message));
    }
  }, [me, view, week, refresh]);
  useEffect(() => {
    if (!me || view === "clock") return;
    const t = setInterval(() => setRefresh((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [me, view]);
  const go = (v: string) => {
    setView(v);
    setMobile(false);
    history.replaceState({}, "", v === "clock" ? "/" : "/admin");
  };
  const adminView = view !== "clock";
  const working = report?.employees.filter((e: any) => e.state !== "out") || [];
  const alerts =
    report?.employees.filter(
      (e: any) =>
        e.flags.length ||
        (e.clockIn &&
          now.getTime() - e.clockIn >
            report.settings.long_shift_hours * 3600000),
    ) || [];
  const nav = [
    ["clock", Clock3, "Time clock"],
    ["overview", LayoutDashboard, "Overview"],
    ["timesheets", CalendarDays, "Weekly timesheets"],
    ["employees", Users, "Employees"],
    ["export", Download, "Payroll export"],
    ["locations", MapPin, "Location reviews"],
    ["settings", Settings, "Settings"],
  ] as const;
  return (
    <div className="app">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("clock");
          }}
        >
          <div className="brandmark">
            H<span>∕</span>
          </div>
          <div>
            HAMILTON<small>WALL SYSTEMS</small>
          </div>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Building2 size={19} />
          </span>
          <div>
            Warehouse<small>Employee timekeeping</small>
          </div>
          <span className="online-dot" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav
            .filter((n) => !config.kiosk || !!me || n[0] === "clock")
            .map(([id, Icon, label]) => (
              <button
                key={id}
                className={view === id ? "nav active" : "nav"}
                onClick={() => go(id)}
              >
                <Icon size={19} />
                {label}
                {id === "clock" && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <ShieldCheck size={22} />
            <strong>Every minute matters.</strong>
            <p>
              Accurate time. Simple payroll.
              <br />
              One less thing to worry about.
            </p>
          </div>
          {me ? (
            <button
              className="profile"
              onClick={() =>
                send("/logout", {}).then(() => {
                  setMe(null);
                  go("clock");
                })
              }
            >
              <span className="avatar">AD</span>
              <div>
                Administrator<small>Sign out securely</small>
              </div>
              <LogOut size={17} />
            </button>
          ) : (
            !config.kiosk && (
              <button className="profile" onClick={() => go("overview")}>
                <span className="avatar">
                  <LockKeyhole size={17} />
                </span>
                <div>
                  Management access<small>Administrator sign in</small>
                </div>
                <ArrowUpRight size={17} />
              </button>
            )
          )}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="mobile-toggle"
            aria-label="Toggle menu"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>{nav.find((n) => n[0] === view)?.[2]}</strong>
          </div>
          <div className="top-right">
            <span className="pill">
              <span className="online-dot" />
              {config.kiosk ? "Kiosk mode" : "Warehouse portal"}
            </span>
            <span className="timezone">
              Eastern Time <Clock3 size={14} />
            </span>
          </div>
        </header>
        <main>
          {!adminView ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">HAMILTON DRYWALL PRODUCTS</div>
                  <h1>
                    Warehouse time clock<span className="title-dot">.</span>
                  </h1>
                  <p>A good day’s work starts here.</p>
                </div>
                <span className="date-badge">
                  <CalendarDays size={17} />
                  {now.toLocaleDateString("en-US", {
                    timeZone: zone,
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
              <ClockPanel config={config} now={now} />
              <div className="below-clock">
                <div>
                  <ShieldCheck size={20} />
                  <span>
                    <strong>Secure & private</strong>
                    <small>Your PIN keeps your punches personal.</small>
                  </span>
                </div>
                <div>
                  <Clock3 size={20} />
                  <span>
                    <strong>Recorded to the second</strong>
                    <small>Every punch uses verified server time.</small>
                  </span>
                </div>
                <div>
                  <Monitor size={20} />
                  <span>
                    <strong>On any device</strong>
                    <small>At the warehouse or on your phone.</small>
                  </span>
                </div>
              </div>
              <div className="phone-note">
                <span>
                  <Sun size={18} /> Keep your day moving.
                </span>
                <button onClick={() => setModal({ kind: "help" })}>
                  Using your own phone? <ArrowUpRight size={15} />
                </button>
              </div>
            </>
          ) : !me ? (
            view === "setup" ? (
              <InitialAdminSetup onComplete={() => go("overview")} />
            ) : (
              <Login onLogin={setMe} />
            )
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MANAGEMENT WORKSPACE</div>
                  <h1>
                    {view === "overview"
                      ? "Your warehouse, at a glance"
                      : nav.find((n) => n[0] === view)?.[2]}
                    <span className="title-dot">.</span>
                  </h1>
                  <p>
                    {view === "overview"
                      ? "A clear view of your team and their time."
                      : "Manage time with confidence."}
                  </p>
                </div>
                {view === "employees" ? (
                  <button
                    className="primary"
                    onClick={() => setModal({ kind: "employee" })}
                  >
                    <Plus size={18} />
                    Add employee
                  </button>
                ) : (
                  view !== "settings" && (
                    <input
                      aria-label="Payroll week"
                      type="date"
                      value={week}
                      onChange={(e) => setWeek(e.target.value)}
                    />
                  )
                )}
              </div>
              {!report ? (
                <div className="card empty">Loading warehouse records…</div>
              ) : (
                <>
                  {view === "overview" && locationData && (
                    <div className="card location-notice">
                      <MapPin size={20} />
                      <span>
                        {
                          locationData.punches.filter(
                            (p: any) => p.review_decision !== "approved",
                          ).length
                        }{" "}
                        punch(es) require location review ·{" "}
                        {locationData.attempts.length} uncompleted location
                        attempt(s)
                      </span>
                      <button
                        className="secondary"
                        onClick={() => go("locations")}
                      >
                        Review locations
                      </button>
                    </div>
                  )}
                  {view === "locations" && (
                    <LocationReviews
                      data={locationData}
                      onSave={() => setRefresh((x) => x + 1)}
                    />
                  )}
                  {view === "overview" && (
                    <>
                      <div className="stats">
                        <Stat
                          label="Currently working"
                          value={working.length}
                          sub="Employees on the clock"
                        />
                        <Stat
                          label="Hours this week"
                          value={hours(
                            report.employees.reduce(
                              (n: number, e: any) => n + e.total,
                              0,
                            ),
                          )}
                          sub="Recorded payable hours"
                        />
                        <Stat
                          label="Needs attention"
                          value={alerts.length}
                          sub="Employees requiring review"
                          warn={!!alerts.length}
                        />
                      </div>
                      <section className="card">
                        <div className="section-head">
                          <div>
                            <h2>Who is working</h2>
                            <p>Live attendance across your warehouse</p>
                          </div>
                          <span className="pill">
                            <span className="online-dot" />
                            Live
                          </span>
                        </div>
                        {working.length ? (
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Employee</th>
                                  <th>Current status</th>
                                  <th>Clock-in time</th>
                                  <th>Hours today</th>
                                </tr>
                              </thead>
                              <tbody>
                                {working.map((e: any) => (
                                  <tr key={e.id}>
                                    <td>
                                      <Employee e={e} />
                                    </td>
                                    <td>
                                      <span
                                        className={
                                          "status " +
                                          (e.state === "lunch" ? "amber" : "")
                                        }
                                      >
                                        {e.state === "lunch"
                                          ? "On lunch"
                                          : "Working"}
                                      </span>
                                    </td>
                                    <td>{time(e.clockIn)}</td>
                                    <td>{hours(e.todayHours)} h</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <Empty
                            title="No one is clocked in"
                            text="Your team will appear here as they start their shifts."
                          />
                        )}
                      </section>
                      {alerts.length > 0 && (
                        <section className="card">
                          <div className="section-head">
                            <div>
                              <h2>Manager review</h2>
                              <p>
                                No shifts are automatically closed or deleted.
                              </p>
                            </div>
                            <AlertCircle size={22} />
                          </div>
                          {alerts.map((e: any) => (
                            <div className="review-row" key={e.id}>
                              <Employee e={e} />
                              <span>
                                {e.clockIn &&
                                Date.now() - e.clockIn >
                                  report.settings.long_shift_hours * 3600000
                                  ? "Unusually long open shift"
                                  : e.flags.join(" · ")}
                              </span>
                              <button
                                className="secondary"
                                onClick={() =>
                                  setModal({ kind: "corrections", employee: e })
                                }
                              >
                                Review punches
                              </button>
                            </div>
                          ))}
                        </section>
                      )}
                    </>
                  )}
                  {view === "timesheets" && (
                    <section className="card">
                      <div className="section-head">
                        <div>
                          <h2>Weekly timesheets</h2>
                          <p>
                            {report.from} — {report.to} · Exact time, displayed
                            to two decimals
                          </p>
                        </div>
                        <button
                          className="secondary"
                          onClick={() => go("export")}
                        >
                          <Download size={16} />
                          Export payroll
                        </button>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Employee</th>
                              {report.employees[0]?.days.map((d: any) => (
                                <th key={d.date}>
                                  {new Date(
                                    d.date + "T12:00:00Z",
                                  ).toLocaleDateString("en-US", {
                                    weekday: "short",
                                    timeZone: zone,
                                  })}
                                  <small>{d.date.slice(5)}</small>
                                </th>
                              ))}
                              <th>Regular</th>
                              <th>Overtime</th>
                              <th>Total</th>
                              <th>Review</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.employees.map((e: any) => (
                              <tr key={e.id}>
                                <td>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      setModal({
                                        kind: "corrections",
                                        employee: e,
                                      })
                                    }
                                  >
                                    <Employee e={e} />
                                  </button>
                                </td>
                                {e.days.map((d: any) => (
                                  <td key={d.date}>
                                    {hours(d.seconds / 3600)}
                                  </td>
                                ))}
                                <td>{hours(e.regular)}</td>
                                <td>{hours(e.overtime)}</td>
                                <td>
                                  <strong>{hours(e.total)}</strong>
                                </td>
                                <td>
                                  {e.flags.length ? (
                                    <span className="status amber">Review</span>
                                  ) : (
                                    <Check size={17} />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!report.employees.length && (
                        <Empty
                          title="Your first workweek starts here"
                          text="Add employees to begin tracking their time."
                        />
                      )}
                      <div className="card-foot">
                        Unpaid recorded lunches are excluded. Open intervals are
                        excluded and flagged for review.
                      </div>
                    </section>
                  )}
                  {view === "employees" && (
                    <section className="card">
                      <div className="section-head">
                        <div>
                          <h2>Your team</h2>
                          <p>Unique, private PINs for every employee</p>
                        </div>
                        <span className="muted">
                          {employees.filter((e) => e.active).length} active
                          employees
                        </span>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Employee</th>
                              <th>Employee ID</th>
                              <th>Warehouse</th>
                              <th>Status</th>
                              <th>Manage</th>
                            </tr>
                          </thead>
                          <tbody>
                            {employees.map((e) => (
                              <tr key={e.id}>
                                <td>
                                  <Employee e={e} />
                                </td>
                                <td>{e.employee_id}</td>
                                <td>{e.location}</td>
                                <td>
                                  <span
                                    className={
                                      "status " + (!e.active ? "gray" : "")
                                    }
                                  >
                                    {e.active ? "Active" : "Inactive"}
                                  </span>
                                </td>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      onClick={() =>
                                        setModal({
                                          kind: "employee",
                                          employee: e,
                                        })
                                      }
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() =>
                                        setModal({ kind: "reset", employee: e })
                                      }
                                    >
                                      Reset PIN
                                    </button>
                                    <button
                                      onClick={() =>
                                        setModal({
                                          kind: "corrections",
                                          employee: e,
                                        })
                                      }
                                    >
                                      Punches
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!employees.length && (
                        <Empty
                          title="Welcome to your new warehouse"
                          text="Add your first employee to generate their secure 4-digit PIN."
                        />
                      )}
                    </section>
                  )}
                  {view === "export" && (
                    <section className="card export-card">
                      <span className="export-icon">
                        <Download size={32} />
                      </span>
                      <div className="eyebrow">READY FOR PAYROLL REVIEW</div>
                      <h2>Your workweek. All accounted for.</h2>
                      <p>
                        Download daily time records and a weekly summary in one
                        <br />
                        professional Excel workbook, with a correction audit
                        worksheet.
                      </p>
                      <div className="export-period">
                        <CalendarDays size={20} />
                        <div>
                          <strong>
                            {report.from} — {report.to}
                          </strong>
                          <small>
                            {report.employees.length} employees · Eastern Time ·
                            40-hour overtime threshold
                          </small>
                        </div>
                      </div>
                      {alerts.length > 0 && (
                        <p className="warning">
                          {alerts.length} employee record(s) need review.
                          Resolve missing punches before finalizing payroll.
                        </p>
                      )}
                      <a className="primary" href={"/api/export?week=" + week}>
                        <Download size={18} />
                        DOWNLOAD WEEKLY PAYROLL
                      </a>
                      <small className="muted">
                        Excel .xlsx · Includes review flags and exact numeric
                        hour totals
                      </small>
                    </section>
                  )}
                  {view === "settings" && (
                    <SettingsForm
                      initial={report.settings}
                      onSave={() => setRefresh((x) => x + 1)}
                      notify={notify}
                    />
                  )}
                </>
              )}
            </>
          )}
        </main>
        <footer>
          <span>© {now.getFullYear()} Hamilton Drywall Products</span>
          <span>
            Built for the people who build.{" "}
            <span className="footer-sep">|</span> America/New_York
          </span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true">
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal.kind === "help" ? (
              <>
                <h2>Take the clock with you.</h2>
                <p>
                  Open this secure website on your phone. In Safari, tap Share →
                  Add to Home Screen. In Chrome, open the menu → Add to Home
                  screen.
                </p>
                <p>
                  Location is requested only when you punch. Precise employee
                  coordinates are not retained. Outside readings require
                  explicit provisional submission. Unavailable or persistently
                  poor GPS is saved for manager review.
                </p>
                <p>
                  Wait for a confirmation before leaving. An internet connection
                  is required.
                </p>
              </>
            ) : modal.kind === "corrections" ? (
              <Corrections
                employee={modal.employee}
                onSave={() => setRefresh((x) => x + 1)}
              />
            ) : (
              <EmployeeForm
                modal={modal}
                onSave={() => {
                  setRefresh((x) => x + 1);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function Employee({ e }: { e: any }) {
  return (
    <div className="employee">
      <span className="avatar">
        {e.name
          .split(" ")
          .map((n: string) => n[0])
          .slice(0, 2)
          .join("")}
      </span>
      <span>
        <strong>{e.name}</strong>
        <small>{e.location}</small>
      </span>
    </div>
  );
}
function Stat({ label, value, sub, warn = false }: any) {
  return (
    <div className="card stat">
      <div>
        {label}
        {warn && <span className="alert-dot" />}
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
function Empty({ title, text }: any) {
  return (
    <div className="empty">
      <Users size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function ClockPanel({ config, now }: any) {
  const [pin, setPin] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null),
    [pending, setPending] = useState<any>(null),
    [error, setError] = useState("");
  const reset = useRef<any>(null);
  useEffect(() => () => clearTimeout(reset.current), []);
  useEffect(() => {
    if (!pin) return;
    const t = setTimeout(() => setPin(""), 30000);
    return () => clearTimeout(t);
  }, [pin]);
  function showResult(r: any) {
    setResult(r);
    setPending(null);
    setPin("");
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setResult(null), 5000);
  }
  async function punch(type: string) {
    if (busy) return;
    if (pin.length !== 4) {
      setError("Please enter your 4-digit PIN.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const coords = config.kiosk ? null : await readPunchLocation();
      let r = await send("/punch", { pin, type, coords });
      setPin("");
      if (r.pending === "retry") {
        setError("GPS accuracy is poor. Requesting a fresh reading…");
        r = await send("/punch/retry", {
          attemptToken: r.attemptToken,
          coords: await readPunchLocation(),
        });
      }
      setError("");
      if (r.pending) {
        setPending(r);
        clearTimeout(reset.current);
        reset.current = setTimeout(() => {
          setPending(null);
          setError(
            "No punch was recorded. Your attempt remains visible to management. Please try again or contact your manager.",
          );
        }, 120000);
      } else showResult(r);
    } catch (e: any) {
      setError(e.message);
      setPin("");
    } finally {
      setBusy(false);
    }
  }
  async function provisional() {
    if (busy) return;
    setBusy(true);
    try {
      showResult(
        await send("/punch/provisional", {
          attemptToken: pending.attemptToken,
        }),
      );
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const add = (n: string) => {
    if (!busy) setPin((p) => (p + n).slice(0, 4));
    setError("");
  };
  return (
    <section className="clock-card">
      <div className="clock-top">
        <span className="live-label">
          <span className="online-dot" />
          WAREHOUSE TIME CLOCK
        </span>
        <span className="clock-location">
          <MapPin size={15} />
          {config.kiosk ? "Shared warehouse device" : "Employee portal"}
        </span>
      </div>
      <div className="clock-body">
        <div className="clock-display">
          <div className="clock-date">
            {now.toLocaleDateString("en-US", {
              timeZone: zone,
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </div>
          <div className="digital-time">
            {now.toLocaleTimeString("en-US", {
              timeZone: zone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
            <span className="seconds">
              :
              {String(
                new Intl.DateTimeFormat("en-US", {
                  timeZone: zone,
                  second: "2-digit",
                }).format(now),
              ).padStart(2, "0")}
            </span>
          </div>
          <div className="time-zone">
            <span />
            EASTERN TIME (NEW YORK)
          </div>
          <div className="clock-rule" />
          <div className="clock-instructions">
            <span className="step-number">1</span>
            <div>
              <strong>Enter your personal PIN</strong>
              <p>Your four digits. Your time.</p>
            </div>
          </div>
          <div className="clock-instructions">
            <span className="step-number">2</span>
            <div>
              <strong>Choose your action</strong>
              <p>We’ll take care of the timestamp.</p>
            </div>
          </div>
          <div className="privacy-note">
            <LockKeyhole size={15} />
            <span>
              Your information stays private.
              <br />
              The screen resets after every punch.
            </span>
          </div>
        </div>
        <div className="clock-controls">
          {pending ? (
            <div className="confirmation" role="status">
              <AlertCircle size={36} />
              <h3>YOU APPEAR TO BE OUTSIDE THE AUTHORIZED WAREHOUSE AREA.</h3>
              <p>
                No normal punch has been recorded. You may submit a provisional
                punch for manager review.
              </p>
              <button className="primary" disabled={busy} onClick={provisional}>
                {busy ? "Saving…" : "Submit provisional punch"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  clearTimeout(reset.current);
                  setError(
                    "No punch recorded. The attempt is retained for manager review.",
                  );
                }}
              >
                Cancel submission
              </button>
              {error && <p className="error">{error}</p>}
            </div>
          ) : result ? (
            <div className="confirmation" role="status">
              <span className="success-icon">
                <Check size={35} />
              </span>
              <div className="eyebrow">
                {result.flagged
                  ? "PROVISIONAL PUNCH RECORDED"
                  : "PUNCH SUCCESSFULLY RECORDED"}
              </div>
              <h2>{result.name}</h2>
              <h3>{names[result.type]}</h3>
              <p>{time(result.at)} Eastern Time</p>
              {result.flagged && (
                <p className="warning">
                  LOCATION COULD NOT BE VERIFIED. YOUR PUNCH HAS BEEN RECORDED
                  FOR MANAGER REVIEW.
                </p>
              )}
              <small>Screen resets in 5 seconds.</small>
            </div>
          ) : (
            <>
              <label className="pin-label" htmlFor="pin">
                Enter your 4-digit PIN <LockKeyhole size={14} />
              </label>
              <div
                className="pin-boxes"
                onClick={() => document.getElementById("pin")?.focus()}
              >
                {[0, 1, 2, 3].map((i) => (
                  <span className={pin.length === i ? "focused" : ""} key={i}>
                    {pin[i] ? "●" : "—"}
                  </span>
                ))}
                <input
                  id="pin"
                  aria-label="4-digit employee PIN"
                  autoComplete="off"
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  maxLength={4}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ""));
                    setError("");
                  }}
                  disabled={busy}
                />
              </div>
              <div className="keypad">
                {[
                  "1",
                  "2",
                  "3",
                  "4",
                  "5",
                  "6",
                  "7",
                  "8",
                  "9",
                  "clear",
                  "0",
                  "delete",
                ].map((n) => (
                  <button
                    key={n}
                    disabled={busy}
                    aria-label={
                      n === "delete"
                        ? "Delete digit"
                        : n === "clear"
                          ? "Clear PIN"
                          : n
                    }
                    onClick={() =>
                      n === "clear"
                        ? setPin("")
                        : n === "delete"
                          ? setPin((p) => p.slice(0, -1))
                          : add(n)
                    }
                    className={isNaN(Number(n)) ? "key-function" : ""}
                  >
                    {n === "delete" ? (
                      <Delete size={20} />
                    ) : n === "clear" ? (
                      "Clear"
                    ) : (
                      n
                    )}
                  </button>
                ))}
              </div>
              <div className="punch-actions">
                <button
                  className="punch-in"
                  disabled={busy}
                  onClick={() => punch("in")}
                >
                  <LogIn size={20} />
                  <span>CLOCK IN</span>
                  <ArrowRight size={18} />
                </button>
                <button disabled={busy} onClick={() => punch("out")}>
                  <LogOut size={20} />
                  <span>CLOCK OUT</span>
                  <ArrowRight size={18} />
                </button>
                <button
                  className="lunch"
                  disabled={busy}
                  onClick={() => punch("lunch_out")}
                >
                  <Coffee size={18} />
                  START LUNCH
                </button>
                <button
                  className="lunch"
                  disabled={busy}
                  onClick={() => punch("lunch_in")}
                >
                  <Sun size={18} />
                  END LUNCH
                </button>
              </div>
              <div className="clock-message" role="status">
                {busy ? (
                  "Checking location and recording your punch…"
                ) : error ? (
                  <span className="error">{error}</span>
                ) : config.geofence_enabled && !config.kiosk ? (
                  "Location is requested only when you punch. Outside readings require provisional submission. Unavailable GPS is recorded for review; exact coordinates are not stored."
                ) : (
                  "Forgot your PIN or missed a punch? Contact your manager."
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="clock-footer">
        <span>
          <ShieldCheck size={14} /> Secure, server-verified timekeeping
        </span>
        <span>No rounding. Just your time.</span>
      </div>
    </section>
  );
}
function InitialAdminSetup({ onComplete }: any) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="card login">
      <span className="export-icon">
        <ShieldCheck size={28} />
      </span>
      <div className="eyebrow">ONE-TIME ADMINISTRATOR SETUP</div>
      <h1>Make it your workspace.</h1>
      <p>
        Use the setup key from your hosting account to create your first
        administrator. The key cannot create additional accounts after setup.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = Object.fromEntries(new FormData(e.currentTarget));
          if (body.password !== body.confirmPassword) {
            setError("Passwords must match.");
            return;
          }
          setBusy(true);
          try {
            await send("/setup", body);
            onComplete();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Setup key
          <input
            name="setupToken"
            type="password"
            required
            minLength={32}
            autoComplete="off"
          />
        </label>
        <label>
          Administrator email
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          Choose a password
          <input
            name="password"
            type="password"
            required
            minLength={14}
            maxLength={200}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirm password
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={14}
            autoComplete="new-password"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Creating administrator…" : "Create administrator"}
        </button>
      </form>
    </section>
  );
}
function Login({ onLogin }: any) {
  const [setupAvailable, setSetupAvailable] = useState(false);
  useEffect(() => {
    api("/setup-status")
      .then((s) => setSetupAvailable(s.available))
      .catch(() => {});
  }, []);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="card login">
      <span className="export-icon">
        <LockKeyhole size={28} />
      </span>
      <div className="eyebrow">MANAGEMENT ACCESS</div>
      <h1>Welcome back.</h1>
      {setupAvailable && (
        <p>
          <a className="text-button" href="/setup">
            Set up your first administrator →
          </a>
        </p>
      )}
      <p>Sign in to manage your team and payroll.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onLogin(
              await send(
                "/login",
                Object.fromEntries(new FormData(e.currentTarget)),
              ),
            );
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email address
          <input type="email" name="email" required autoComplete="username" />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in securely"}
          <ArrowRight size={17} />
        </button>
      </form>
    </section>
  );
}
function EmployeeForm({ modal, onSave }: any) {
  const [error, setError] = useState(""),
    [pin, setPin] = useState(""),
    [busy, setBusy] = useState(false);
  const e = modal.employee;
  return (
    <>
      <h2>
        {modal.kind === "reset"
          ? "Reset employee PIN"
          : e
            ? "Edit employee"
            : "Add an employee"}
      </h2>
      <p>{e ? e.name : "Generate a unique PIN for your new team member."}</p>
      {pin ? (
        <div className="pin-reveal">
          <strong>{pin}</strong>
          <p>
            Share this PIN privately with the employee.
            <br />
            It will not be shown again after closing.
          </p>
        </div>
      ) : (
        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            setBusy(true);
            setError("");
            try {
              const b = Object.fromEntries(new FormData(ev.currentTarget));
              if (modal.kind === "reset") {
                setPin((await send("/employees/" + e.id + "/pin", {})).pin);
              } else if (e) {
                await send(
                  "/employees/" + e.id,
                  { ...b, active: b.active === "on" },
                  "PATCH",
                );
                setError("Employee updated.");
              } else {
                setPin((await send("/employees", b)).pin);
              }
              onSave();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {modal.kind === "reset" ? (
            <p>Generating a new PIN immediately disables the old one.</p>
          ) : (
            <>
              <label>
                Employee name
                <input
                  name="name"
                  defaultValue={e?.name}
                  required
                  maxLength={100}
                />
              </label>
              {!e && (
                <label>
                  Employee ID
                  <input
                    name="employee_id"
                    placeholder="e.g. HDP-001"
                    required
                    maxLength={30}
                  />
                </label>
              )}
              <label>
                Warehouse location
                <input
                  name="location"
                  defaultValue={e?.location || "Main warehouse"}
                  required
                  maxLength={100}
                />
              </label>
              {e && (
                <label className="check-label">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={e.active}
                  />
                  Employee is active
                </label>
              )}
            </>
          )}
          {error && (
            <p role="status" className="warning">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : modal.kind === "reset"
                ? "Generate new PIN"
                : e
                  ? "Save employee"
                  : "Add employee & generate PIN"}
          </button>
        </form>
      )}
    </>
  );
}
function Corrections({ employee, onSave }: any) {
  const [data, setData] = useState<any>(null),
    [selected, setSelected] = useState<any>(null),
    [message, setMessage] = useState(""),
    [punchDate, setPunchDate] = useState(dateNY()),
    [punchTime, setPunchTime] = useState(""),
    [occurrence, setOccurrence] = useState<Occurrence | "">(""),
    [type, setType] = useState("in"),
    [busy, setBusy] = useState(false);
  const reload = () =>
    api("/punches/" + employee.id)
      .then(setData)
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    reload();
  }, [employee.id]);
  let choices: ReturnType<typeof punchTimeChoices> = [];
  try {
    choices = punchTimeChoices(punchDate, punchTime);
  } catch {}
  return (
    <>
      <h2>Review & correct punches</h2>
      <p>{employee.name} · Original records are always preserved.</p>
      <label>
        Record to correct
        <select
          onChange={(e) => {
            const p = data?.punches.find((p: any) => p.id === e.target.value);
            setSelected(p || null);
            setType(p?.type || "in");
            const fields = p
              ? punchTimeFields(p.at)
              : { date: dateNY(), time: "", occurrence: undefined };
            setPunchDate(fields.date);
            setPunchTime(fields.time);
            setOccurrence(fields.occurrence || "");
            setMessage("");
          }}
        >
          <option value="">Add a missing punch</option>
          {data?.punches.map((p: any) => (
            <option key={p.id} value={p.id}>
              {new Date(p.at).toLocaleString("en-US", { timeZone: zone })} ·{" "}
              {names[p.type]}
            </option>
          ))}
        </select>
      </label>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const b = Object.fromEntries(new FormData(e.currentTarget));
            await send("/corrections", {
              employee_id: employee.id,
              punch_id: selected?.id,
              type,
              ...correctionTimePayload(selected?.at, {
                date: punchDate,
                time: punchTime,
                occurrence: occurrence || undefined,
              }),
              reason: b.reason,
            });
            setMessage("Correction saved. Audit history preserved.");
            reload();
            onSave();
          } catch (e: any) {
            setMessage(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Punch type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(names).map(([k, v]: any) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Date
            <input
              type="date"
              required
              value={punchDate}
              onChange={(e) => {
                setPunchDate(e.target.value);
                setOccurrence("");
              }}
            />
          </label>
          <label>
            Time (AM/PM)
            <input
              type="text"
              required
              value={punchTime}
              maxLength={20}
              onChange={(e) => {
                setPunchTime(e.target.value);
                setOccurrence("");
              }}
              placeholder="09:00 AM or 6:07 PM"
              autoComplete="off"
              autoCapitalize="characters"
              aria-describedby="punch-time-help"
            />
          </label>
        </div>
        <small id="punch-time-help" className="muted">
          Enter 09:00 AM or 6:07 PM. All punch dates and times use New York
          time.
        </small>
        {choices.length > 1 && (
          <label>
            This time occurs twice when clocks move back
            <select
              required
              value={occurrence}
              onChange={(e) => setOccurrence(e.target.value as Occurrence)}
            >
              <option value="">Choose which occurrence</option>
              {choices.map((c) => (
                <option key={c.at} value={c.occurrence}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Correction reason
          <textarea
            name="reason"
            required
            minLength={5}
            placeholder="Explain the missing or inaccurate punch"
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save correction"}
        </button>
      </form>
      {message && (
        <p className="warning" role="status">
          {message}
        </p>
      )}
      <details>
        <summary>Punch records & audit history</summary>
        <div className="audit-list">
          {data?.punches.map((p: any) => (
            <p key={p.id}>
              {new Date(p.at).toLocaleString("en-US", { timeZone: zone })} ·{" "}
              {names[p.type]}
              <small>
                {locationLabels[p.location_check] || p.location_check} ·{" "}
                {p.review_decision || "Not reviewed"}
              </small>
              {p.reason && <small>Added by manager: {p.reason}</small>}
            </p>
          ))}
          {data?.audit.map((a: any) => (
            <p key={a.id}>
              <strong>{a.reason}</strong>
              <small>
                {a.email} · {new Date(a.at).toISOString()}
              </small>
              <small>Original: {JSON.stringify(a.original_value)}</small>
              <small>Corrected: {JSON.stringify(a.corrected_value)}</small>
            </p>
          ))}
        </div>
      </details>
    </>
  );
}
function LocationReviews({ data, onSave }: any) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState("");
  if (!data) return <div className="card empty">Loading location records…</div>;
  return (
    <>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Location verification review</h2>
            <p>
              Provisional punches remain in attendance and payroll. Approval
              records a decision; it does not prove physical presence.
            </p>
          </div>
        </div>
        {!data.punches.length && (
          <Empty
            title="No flagged punches"
            text="Location exceptions will appear here."
          />
        )}
        {data.punches.map((p: any) => (
          <div className="location-review" key={p.id}>
            <div className="review-summary">
              <strong>
                {p.name} · {names[p.type]}
              </strong>
              <small>
                {new Date(p.at).toLocaleString("en-US", { timeZone: zone })}{" "}
                Eastern
              </small>
              <span className="status amber">
                {locationLabels[p.location_check]}
              </span>
              <p>
                Approximate distance:{" "}
                {p.approximate_distance_m === null
                  ? "Unavailable"
                  : Math.round(p.approximate_distance_m / 0.3048) + " ft"}{" "}
                · GPS accuracy:{" "}
                {p.accuracy_m === null ? "Unavailable" : p.accuracy_m + " m"} ·
                Decision: {p.review_decision || "Pending"}
              </p>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const b = Object.fromEntries(new FormData(e.currentTarget));
                setBusy(p.id);
                try {
                  await send("/location-reviews/" + p.id, b);
                  setMessage(
                    "Decision saved with administrator, reason, previous decision and timestamp.",
                  );
                  onSave();
                } catch (e: any) {
                  setMessage(e.message);
                } finally {
                  setBusy("");
                }
              }}
            >
              <label>
                Decision
                <select name="decision" required>
                  <option value="approved">Approve recorded punch</option>
                  <option value="follow_up">
                    Follow-up / correction required
                  </option>
                </select>
              </label>
              <label>
                Decision reason
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={1000}
                  required
                  placeholder="Document how you reviewed this punch"
                />
              </label>
              <button className="secondary" disabled={!!busy}>
                {busy === p.id ? "Saving…" : "Save review decision"}
              </button>
            </form>
          </div>
        ))}
        {message && (
          <p className="warning" role="status">
            {message}
          </p>
        )}
      </section>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Uncompleted punch attempts</h2>
            <p>
              These attempts have not created payable punches. They are retained
              if a retry or provisional submission is abandoned or expires.
              Review the employee’s punch history and add a missing punch with a
              reason when appropriate.
            </p>
          </div>
        </div>
        {data.attempts.map((a: any) => (
          <div className="location-review" key={a.id}>
            <div>
              <strong>{a.name}</strong>
              <p>
                {names[a.type]} ·{" "}
                {new Date(a.at).toLocaleString("en-US", { timeZone: zone })}
              </p>
              <span className="status amber">{locationLabels[a.status]}</span>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const body = Object.fromEntries(new FormData(e.currentTarget));
                setBusy(a.id);
                try {
                  await send("/location-attempts/" + a.id + "/review", body);
                  setMessage(
                    "Attempt reviewed. No punch has been added; use missed-punch corrections if time must be recorded.",
                  );
                  onSave();
                } catch (e: any) {
                  setMessage(e.message);
                } finally {
                  setBusy("");
                }
              }}
            >
              <label>
                Handling decision / reason
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={1000}
                  required
                  placeholder="Explain any correction added or why no punch is needed"
                />
              </label>
              <button className="secondary" disabled={!!busy}>
                Mark attempt reviewed (no punch added)
              </button>
            </form>
          </div>
        ))}
        {!data.attempts.length && (
          <p className="empty">No uncompleted attempts.</p>
        )}
      </section>
      <section className="card">
        <div className="section-head">
          <h2>Location decisions & device audit</h2>
        </div>
        <div className="audit-list location-audit">
          {data.audit.map((r: any) => (
            <p key={r.id}>
              <strong>
                {r.name} · {r.decision}
              </strong>
              <small>
                {r.reason} · Previous: {r.previous_decision || "Pending"}
              </small>
              <small>
                {r.email} · {new Date(r.at).toISOString()}
              </small>
            </p>
          ))}
          {data.attemptAudit.map((r: any) => (
            <p key={r.id}>
              <strong>
                {r.name} · Uncompleted {names[r.type]} attempt reviewed
              </strong>
              <small>{r.reason}</small>
              <small>
                {r.email} · {new Date(r.at).toISOString()}
              </small>
            </p>
          ))}
          {data.kioskAudit.map((a: any) => (
            <p key={a.id}>
              <strong>
                {a.name} · Device {a.action}
              </strong>
              <small>
                {a.email} · {new Date(a.at).toISOString()}
              </small>
            </p>
          ))}
        </div>
      </section>
    </>
  );
}
function SettingsForm({ initial, onSave, notify }: any) {
  const [busy, setBusy] = useState(false);
  const [kiosks, setKiosks] = useState<any[]>([]);
  const loadKiosks = () =>
    api("/kiosks")
      .then(setKiosks)
      .catch((e) => notify(e.message));
  useEffect(() => {
    loadKiosks();
  }, []);
  return (
    <section className="card settings-card">
      <h2>Warehouse settings</h2>
      <p>Policies apply to all employee timesheets.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const b: any = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          try {
            await send(
              "/settings",
              {
                workweek_start: Number(b.workweek_start),
                long_shift_hours: Number(b.long_shift_hours),
                geofence_enabled: true,
                latitude: b.latitude === "" ? null : Number(b.latitude),
                longitude: b.longitude === "" ? null : Number(b.longitude),
                radius_m: Number(b.radius_feet) * 0.3048,
              },
              "PUT",
            );
            notify("Settings saved.");
            onSave();
          } catch (e: any) {
            notify(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Payroll week starts
            <select name="workweek_start" defaultValue={initial.workweek_start}>
              {[
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
              ].map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Open shift alert after (hours)
            <input
              name="long_shift_hours"
              type="number"
              min={8}
              max={48}
              defaultValue={initial.long_shift_hours}
            />
          </label>
        </div>
        <div className="setting-divider" />
        <h3>Required warehouse location verification</h3>
        <p>
          Checks location at punch time on personal phones. Unverified punches
          are recorded and flagged. Precise employee coordinates are never
          stored.
        </p>
        <div className="form-grid">
          <label>
            Warehouse latitude
            <input
              name="latitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              defaultValue={initial.latitude ?? ""}
              required
            />
          </label>
          <label>
            Warehouse longitude
            <input
              name="longitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              defaultValue={initial.longitude ?? ""}
              required
            />
          </label>
          <label>
            Radius (feet)
            <input
              name="radius_feet"
              type="number"
              min={10}
              max={32808}
              step="any"
              defaultValue={Number((initial.radius_m / 0.3048).toFixed(2))}
            />
          </label>
        </div>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
          <Check size={17} />
        </button>
      </form>
      <div className="setting-divider" />
      <h3>Shared warehouse device</h3>
      <p>
        Enroll this device in kiosk mode for 30 days. This signs out the
        administrator and hides management navigation. Operating-system kiosk
        controls should also restrict browser navigation.
      </p>
      <label>
        Device name
        <input
          id="kiosk-name"
          maxLength={100}
          placeholder="e.g. Warehouse entrance tablet"
        />
      </label>
      <button
        className="secondary"
        onClick={async () => {
          try {
            const name = (
              document.getElementById("kiosk-name") as HTMLInputElement
            ).value.trim();
            if (!name) {
              notify("Enter a device name first.");
              return;
            }
            await send("/kiosk", { enabled: true, name });
            location.href = "/";
          } catch (e: any) {
            notify(e.message);
          }
        }}
      >
        <Monitor size={18} />
        Enable kiosk on this device
      </button>
      <button
        className="text-button"
        onClick={async () => {
          await send("/kiosk", { enabled: false });
          notify("Kiosk enrollment removed.");
        }}
      >
        Remove kiosk enrollment
      </button>
      <h3>Registered warehouse devices</h3>
      {kiosks.map((k) => (
        <div className="review-row" key={k.id}>
          <div>
            <strong>{k.name}</strong>
            <p>
              Registered by {k.email} · Expires{" "}
              {new Date(k.expires_at).toLocaleDateString()} ·{" "}
              {k.revoked_at ? "Revoked" : "Enrolled"}
            </p>
          </div>
          {!k.revoked_at && (
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await api("/kiosks/" + k.id, { method: "DELETE" });
                  loadKiosks();
                  notify("Device revoked immediately.");
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              Revoke device
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
