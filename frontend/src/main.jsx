import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const statuses = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In Progress" },
  { id: "resolved", label: "Resolved" },
  { id: "closed", label: "Closed" }
];
const priorities = ["low", "medium", "high", "urgent"];
const initialForm = { subject: "", description: "", customerEmail: "", priority: "medium" };

function formatAge(minutes) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function adjacentStatus(status, direction) {
  const index = statuses.findIndex((item) => item.id === status);
  return statuses[index + direction]?.id || null;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }

  if (response.status === 204) return null;
  return response.json();
}

function App() {
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [priority, setPriority] = useState("");
  const [breachedOnly, setBreachedOnly] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [formErrors, setFormErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const grouped = useMemo(() => {
    return Object.fromEntries(statuses.map((status) => [status.id, tickets.filter((ticket) => ticket.status === status.id)]));
  }, [tickets]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (priority) params.set("priority", priority);
      if (breachedOnly) params.set("breached", "true");
      const suffix = params.toString() ? `?${params}` : "";
      const [ticketData, statsData] = await Promise.all([request(`/tickets${suffix}`), request("/tickets/stats")]);
      setTickets(ticketData);
      setStats(statsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [priority, breachedOnly]);

  function validateForm() {
    const nextErrors = {};
    if (!form.subject.trim()) nextErrors.subject = "Subject is required";
    if (!form.description.trim()) nextErrors.description = "Description is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail)) nextErrors.customerEmail = "Enter a valid email";
    if (!priorities.includes(form.priority)) nextErrors.priority = "Choose a priority";
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function createTicket(event) {
    event.preventDefault();
    if (!validateForm()) return;
    setSaving(true);
    setError("");

    try {
      const ticket = await request("/tickets", { method: "POST", body: JSON.stringify(form) });
      setTickets((current) => [ticket, ...current]);
      setForm(initialForm);
      setFormErrors({});
      const statsData = await request("/tickets/stats");
      setStats(statsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function moveTicket(ticket, direction) {
    const nextStatus = adjacentStatus(ticket.status, direction);
    if (!nextStatus) return;

    try {
      const updated = await request(`/tickets/${ticket._id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      setTickets((current) => current.map((item) => (item._id === updated._id ? updated : item)));
      setStats(await request("/tickets/stats"));
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteTicket(ticketId) {
    try {
      await request(`/tickets/${ticketId}`, { method: "DELETE" });
      setTickets((current) => current.filter((ticket) => ticket._id !== ticketId));
      setStats(await request("/tickets/stats"));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Support Ticket Triage</p>
          <h1>DeskFlow</h1>
        </div>
        <button className="icon-button" onClick={loadData} aria-label="Refresh tickets" title="Refresh tickets">
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="controls" aria-label="Ticket filters">
        <label>
          Priority
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="">All priorities</option>
            {priorities.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={breachedOnly} onChange={(event) => setBreachedOnly(event.target.checked)} />
          SLA breached only
        </label>
      </section>

      {stats && (
        <section className="stats-strip" aria-label="Ticket statistics">
          {statuses.map((status) => (
            <div key={status.id}>
              <span>{status.label}</span>
              <strong>{stats.perStatus?.[status.id] || 0}</strong>
            </div>
          ))}
          <div className="breach-stat">
            <span>Open breaches</span>
            <strong>{stats.breachedOpen || 0}</strong>
          </div>
        </section>
      )}

      {error && <div className="error-banner">{error}</div>}

      <section className="board" aria-busy={loading}>
        {statuses.map((status) => (
          <div className="column" key={status.id}>
            <div className="column-header">
              <h2>{status.label}</h2>
              <span>{grouped[status.id]?.length || 0}</span>
            </div>
            {loading ? (
              <div className="empty-state">
                <Loader2 className="spin" size={20} /> Loading
              </div>
            ) : grouped[status.id]?.length ? (
              grouped[status.id].map((ticket) => (
                <article className={`ticket-card ${ticket.slaBreached ? "breached" : ""}`} key={ticket._id}>
                  <div className="card-title-row">
                    <h3>{ticket.subject}</h3>
                    <span className={`priority ${ticket.priority}`}>{ticket.priority}</span>
                  </div>
                  <p>{ticket.description}</p>
                  <div className="meta-row">
                    <span>{formatAge(ticket.ageMinutes)}</span>
                    {ticket.slaBreached && (
                      <span className="breach-label">
                        <AlertTriangle size={14} /> SLA
                      </span>
                    )}
                  </div>
                  <div className="card-actions">
                    {adjacentStatus(ticket.status, -1) && (
                      <button onClick={() => moveTicket(ticket, -1)} title="Move back" aria-label="Move back">
                        <ArrowLeft size={16} />
                      </button>
                    )}
                    {adjacentStatus(ticket.status, 1) && (
                      <button onClick={() => moveTicket(ticket, 1)} title="Move forward" aria-label="Move forward">
                        <ArrowRight size={16} />
                      </button>
                    )}
                    <button onClick={() => deleteTicket(ticket._id)} title="Delete ticket" aria-label="Delete ticket">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">No tickets</div>
            )}
          </div>
        ))}
      </section>

      <section className="create-panel">
        <div>
          <p className="eyebrow">New Request</p>
          <h2>Create Ticket</h2>
        </div>
        <form onSubmit={createTicket} noValidate>
          <label>
            Subject
            <input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} />
            {formErrors.subject && <span className="field-error">{formErrors.subject}</span>}
          </label>
          <label>
            Description
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            {formErrors.description && <span className="field-error">{formErrors.description}</span>}
          </label>
          <label>
            Customer Email
            <input value={form.customerEmail} onChange={(event) => setForm({ ...form, customerEmail: event.target.value })} />
            {formErrors.customerEmail && <span className="field-error">{formErrors.customerEmail}</span>}
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              {priorities.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" disabled={saving}>
            {saving ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
            Create Ticket
          </button>
        </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
