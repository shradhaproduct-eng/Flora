import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../utils.js";

// The pipeline an order walks through; pickup orders skip delivery.
const FLOW = ["enquiry", "confirmed", "in_progress", "ready", "out_for_delivery", "delivered"];
const NEXT_LABEL = {
  confirmed: "Confirm",
  in_progress: "Start making",
  ready: "Mark ready",
  out_for_delivery: "Send out",
  delivered: "Mark delivered",
};
const CLOSED = new Set(["delivered", "cancelled"]);

const VIEWS = [
  { id: "open", label: "Open" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "enquiry", label: "Enquiries" },
  { id: "unpaid", label: "Unpaid" },
  { id: "delivered", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD in the browser's timezone
};

function isOverdue(order, today) {
  return order.due_date < today && !CLOSED.has(order.status);
}

function nextStatus(order) {
  if (CLOSED.has(order.status)) return null;
  const flow = order.fulfilment === "pickup" ? FLOW.filter((s) => s !== "out_for_delivery") : FLOW;
  return flow[flow.indexOf(order.status) + 1] ?? null;
}

function statusLabel(order, statuses) {
  if (order.status === "delivered" && order.fulfilment === "pickup") return "Collected";
  return statuses[order.status] ?? order.status;
}

function nextLabel(order, status) {
  if (status === "delivered" && order.fulfilment === "pickup") return "Mark collected";
  return NEXT_LABEL[status];
}

function balanceOf(order) {
  return Math.max(0, (order.price || 0) - (order.amount_paid || 0));
}

function payment(order) {
  if (order.price > 0 && order.amount_paid >= order.price) return { label: "Paid", tone: "ok" };
  if (order.amount_paid > 0) return { label: `${formatCurrency(balanceOf(order))} due`, tone: "low" };
  if (order.price > 0) return { label: "Unpaid", tone: "out" };
  return null;
}

function formatDay(dateString) {
  if (dateString === localDate()) return "Today";
  if (dateString === localDate(1)) return "Tomorrow";
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const emptyOrder = () => ({
  customer_name: "",
  customer_phone: "",
  source: "walk_in",
  status: "confirmed",
  fulfilment: "delivery",
  due_date: localDate(),
  due_time: "",
  recipient_name: "",
  recipient_phone: "",
  delivery_address: "",
  card_message: "",
  description: "",
  notes: "",
  price: "",
  amount_paid: "",
  arrangement_id: "",
});

export default function Orders({ api, notify, arrangements }) {
  const [statuses, setStatuses] = useState({});
  const [sources, setSources] = useState({});
  const [orders, setOrders] = useState([]);
  const [view, setView] = useState("open");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null); // null = closed; has id when editing

  const refresh = useCallback(async () => {
    const data = await api.getOrders();
    setStatuses(data.statuses);
    setSources(data.sources);
    setOrders(data.orders);
  }, [api]);

  useEffect(() => {
    refresh().catch((err) => notify(err.message, "error"));
  }, [refresh, notify]);

  const today = localDate();
  const tomorrow = localDate(1);
  const inView = useCallback(
    (order, id) => {
      switch (id) {
        case "open":
          return !CLOSED.has(order.status);
        case "today":
          return order.due_date === today && order.status !== "cancelled";
        case "tomorrow":
          return order.due_date === tomorrow && order.status !== "cancelled";
        case "unpaid":
          return order.status !== "cancelled" && balanceOf(order) > 0;
        case "all":
          return true;
        default:
          return order.status === id;
      }
    },
    [today, tomorrow]
  );

  // Completed/cancelled/all read best newest-first; working lists soonest-first.
  const historyView = ["delivered", "cancelled", "all"].includes(view);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (o) =>
      !q ||
      [o.order_number, o.customer_name, o.customer_phone, o.recipient_name, o.description]
        .join(" ")
        .toLowerCase()
        .includes(q);
    const list = orders.filter((o) => inView(o, view) && matches(o));
    return historyView ? [...list].reverse() : list;
  }, [orders, view, search, inView, historyView]);

  // Group by due date. In working views, open orders that are late are
  // pulled into an "Overdue" group at the top; history views stay purely
  // by date and mark late orders on the row instead.
  const groups = useMemo(() => {
    const out = [];
    for (const order of visible) {
      const overdue = !historyView && isOverdue(order, today);
      const key = overdue ? "overdue" : order.due_date;
      let group = out.find((g) => g.key === key);
      if (!group) {
        group = { key, label: overdue ? "Overdue" : formatDay(order.due_date), orders: [] };
        out.push(group);
      }
      group.orders.push(order);
    }
    return out.sort((a, b) => (a.key === "overdue" ? -1 : b.key === "overdue" ? 1 : 0));
  }, [visible, today, historyView]);

  async function advance(order) {
    const status = nextStatus(order);
    try {
      await api.setOrderStatus(order.id, status);
      await refresh();
      notify(`${order.order_number}: ${statusLabel({ ...order, status }, statuses)}.`, "success");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function openOrder(order) {
    try {
      const full = await api.getOrder(order.id);
      setForm(toForm(full));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      const saved = form.id ? await api.updateOrder(form.id, form) : await api.createOrder(form);
      await refresh();
      notify(`${form.id ? "Saved" : "Created"} order ${saved.order_number}.`, "success");
      setForm(null);
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete order ${form.order_number}? This can't be undone. (Use Cancelled to keep a record.)`)) return;
    try {
      await api.deleteOrder(form.id);
      await refresh();
      notify(`Deleted order ${form.order_number}.`, "success");
      setForm(null);
    } catch (err) {
      notify(err.message, "error");
    }
  }

  const counts = useMemo(
    () => Object.fromEntries(VIEWS.map((v) => [v.id, orders.filter((o) => inView(o, v.id)).length])),
    [orders, inView]
  );

  return (
    <div className="stack">
      {form && (
        <OrderForm
          api={api}
          form={form}
          setForm={setForm}
          statuses={statuses}
          sources={sources}
          arrangements={arrangements}
          notify={notify}
          onSubmit={handleSave}
          onCancel={() => setForm(null)}
          onDelete={handleDelete}
          onStationeryUsed={(order) => {
            setForm((prev) => ({ ...prev, stationery: order.stationery }));
            refresh();
          }}
        />
      )}

      <section className="card">
        <div className="card-header wrap">
          <h2>Orders</h2>
          <div className="toolbar">
            <a className="btn-secondary" href={api.ordersExportUrl} download>
              ⬇ Download Excel
            </a>
            <button type="button" className="btn-primary" onClick={() => setForm(emptyOrder())}>
              + New order
            </button>
          </div>
        </div>

        <input
          type="search"
          className="search-input"
          placeholder="Search by name, phone, order number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="filter-chips" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={`chip ${view === v.id ? "active" : ""} ${v.id === "unpaid" && counts.unpaid ? "chip-warn" : ""}`}
              onClick={() => setView(v.id)}
            >
              {v.label} ({counts[v.id] ?? 0})
            </button>
          ))}
        </div>

        {orders.length === 0 ? (
          <p className="empty-state">No orders yet. Add your first one with “New order”.</p>
        ) : groups.length === 0 ? (
          <p className="empty-state">Nothing here{search ? " matching your search" : ""}.</p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="order-group">
              <h3 className={`order-group-title ${group.key === "overdue" ? "overdue" : ""}`}>
                {group.label} <span className="muted">({group.orders.length})</span>
              </h3>
              <ul className="order-list">
                {group.orders.map((order) => {
                  const next = nextStatus(order);
                  const pay = payment(order);
                  return (
                    <li key={order.id} className={`order-row status-${order.status}`}>
                      <button type="button" className="order-main" onClick={() => openOrder(order)}>
                        <span className={`order-when ${isOverdue(order, today) ? "late" : ""}`}>
                          {order.due_time || "Any time"}
                          <span className="muted">{order.order_number}</span>
                        </span>
                        <span className="order-info">
                          <strong>{order.customer_name}</strong>
                          <span className="muted order-desc">
                            {order.fulfilment === "pickup" ? "🏬 Pickup" : "🚚 Delivery"}
                            {order.description && ` · ${order.description}`}
                          </span>
                        </span>
                      </button>
                      <div className="order-side">
                        <span className={`badge status-badge status-badge-${order.status}`}>
                          {statusLabel(order, statuses)}
                        </span>
                        {order.price > 0 && <span className="order-price">{formatCurrency(order.price)}</span>}
                        {pay && <span className={`badge badge-${pay.tone}`}>{pay.label}</span>}
                        {next && (
                          <button type="button" className="btn-secondary btn-small" onClick={() => advance(order)}>
                            {nextLabel(order, next)} →
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

// Order fields as form state (numbers as strings so inputs can be cleared).
function toForm(order) {
  return {
    ...order,
    price: order.price || "",
    amount_paid: order.amount_paid || "",
    arrangement_id: order.arrangement_id ?? "",
  };
}

function OrderForm({
  api,
  form,
  setForm,
  statuses,
  sources,
  arrangements,
  notify,
  onSubmit,
  onCancel,
  onDelete,
  onStationeryUsed,
}) {
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const arrangement = arrangements.find((a) => a.id === Number(form.arrangement_id));
  const price = Number(form.price) || 0;
  const paid = Number(form.amount_paid) || 0;

  return (
    <form className="card order-form" onSubmit={onSubmit}>
      <div className="card-header wrap">
        <h2>{form.id ? `Order ${form.order_number}` : "New order"}</h2>
        <label className="field inline-field">
          <span>Status</span>
          <select value={form.status} onChange={set("status")}>
            {Object.entries(statuses).map(([key, label]) => (
              <option key={key} value={key}>
                {key === "delivered" && form.fulfilment === "pickup" ? "Collected" : label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend>Customer</legend>
        <div className="grid-3">
          <label className="field">
            <span>Name</span>
            <input type="text" value={form.customer_name} onChange={set("customer_name")} autoFocus={!form.id} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input type="tel" value={form.customer_phone} onChange={set("customer_phone")} placeholder="+971…" />
          </label>
          <label className="field">
            <span>Came in via</span>
            <select value={form.source} onChange={set("source")}>
              {Object.entries(sources).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>When &amp; how</legend>
        <div className="grid-3">
          <label className="field">
            <span>Due date</span>
            <input type="date" value={form.due_date} onChange={set("due_date")} />
          </label>
          <label className="field">
            <span>Time (optional)</span>
            <input type="time" value={form.due_time} onChange={set("due_time")} />
          </label>
          <div className="field">
            <span>Fulfilment</span>
            <div className="segmented" role="radiogroup">
              {[
                ["delivery", "🚚 Delivery"],
                ["pickup", "🏬 Pickup"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={form.fulfilment === value}
                  className={form.fulfilment === value ? "active" : ""}
                  onClick={() => setForm((prev) => ({ ...prev, fulfilment: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {form.fulfilment === "delivery" && (
          <div className="grid-3">
            <label className="field">
              <span>Recipient</span>
              <input type="text" value={form.recipient_name} onChange={set("recipient_name")} />
            </label>
            <label className="field">
              <span>Recipient phone</span>
              <input type="tel" value={form.recipient_phone} onChange={set("recipient_phone")} />
            </label>
            <label className="field">
              <span>Delivery address</span>
              <input type="text" value={form.delivery_address} onChange={set("delivery_address")} />
            </label>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Order</legend>
        <label className="field">
          <span>What they ordered</span>
          <textarea
            rows={2}
            value={form.description}
            onChange={set("description")}
            placeholder="e.g. Pink & white hand-tied bouquet, ~25 stems, kraft wrap"
          />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Card message</span>
            <textarea rows={2} value={form.card_message} onChange={set("card_message")} />
          </label>
          <label className="field">
            <span>Linked arrangement (optional)</span>
            <select value={form.arrangement_id} onChange={set("arrangement_id")}>
              <option value="">None</option>
              {arrangements.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — cost {formatCurrency(a.total_cost)}
                </option>
              ))}
            </select>
            {arrangement && price > 0 && (
              <small>
                Cost {formatCurrency(arrangement.total_cost)} · margin{" "}
                <strong className={price - arrangement.total_cost >= 0 ? "profit-positive" : "profit-negative"}>
                  {formatCurrency(price - arrangement.total_cost)}
                </strong>
              </small>
            )}
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Payment</legend>
        <div className="grid-3">
          <label className="field">
            <span>Price</span>
            <div className="prefixed-input">
              <span>AED</span>
              <input type="number" min="0" step="0.01" value={form.price} onChange={set("price")} />
            </div>
          </label>
          <label className="field">
            <span>Paid so far</span>
            <div className="prefixed-input">
              <span>AED</span>
              <input type="number" min="0" step="0.01" value={form.amount_paid} onChange={set("amount_paid")} />
            </div>
          </label>
          <div className="field">
            <span>Balance</span>
            <div className="balance">
              {price > 0 && paid >= price ? (
                <span className="profit-positive">Paid in full</span>
              ) : (
                <span>{formatCurrency(Math.max(0, price - paid))}</span>
              )}
              {price > paid && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setForm((prev) => ({ ...prev, amount_paid: prev.price }))}
                >
                  Mark paid
                </button>
              )}
            </div>
          </div>
        </div>
      </fieldset>

      <label className="field">
        <span>Internal notes</span>
        <input type="text" value={form.notes} onChange={set("notes")} placeholder="Not shown to the customer" />
      </label>

      {form.id && <StationeryUsed api={api} order={form} notify={notify} onUsed={onStationeryUsed} />}

      <div className="card-actions spread">
        {form.id ? (
          <button type="button" className="btn-link danger" onClick={onDelete}>
            Delete order
          </button>
        ) : (
          <span />
        )}
        <div className="toolbar">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!form.customer_name.trim() || !form.due_date}>
            {form.id ? "Save changes" : "Create order"}
          </button>
        </div>
      </div>
    </form>
  );
}

// Stationery used on a saved order; adding a line takes it out of inventory.
function StationeryUsed({ api, order, notify, onUsed }) {
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    api.getInventory().then(
      (data) => setItems(data.items),
      (err) => notify(err.message, "error")
    );
  }, [api, notify, order.stationery?.length]);

  async function handleAdd() {
    try {
      const updated = await api.useStationeryOnOrder(order.id, Number(itemId), Number(quantity));
      const item = items.find((i) => i.id === Number(itemId));
      notify(`Used ${quantity} ${item?.unit ?? ""} ${item?.name ?? ""} — taken out of inventory.`, "success");
      setItemId("");
      setQuantity(1);
      onUsed(updated);
    } catch (err) {
      notify(err.message, "error");
    }
  }

  return (
    <fieldset>
      <legend>Stationery used</legend>
      {order.stationery?.length > 0 ? (
        <ul className="stationery-used">
          {order.stationery.map((s) => (
            <li key={s.id}>
              {s.quantity} × {s.item_name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing recorded yet.</p>
      )}
      {items.length > 0 ? (
        <div className="adjust stationery-add">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Stationery item">
            <option value="">Choose wrapping, ribbon, card…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id} disabled={i.quantity === 0}>
                {i.name} ({i.quantity} {i.unit} left)
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            step="1"
            aria-label="Quantity used"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <button type="button" className="btn-secondary" disabled={!itemId} onClick={handleAdd}>
            Use
          </button>
        </div>
      ) : (
        <p className="muted">Add stationery in the Inventory tab to track what each order uses.</p>
      )}
    </fieldset>
  );
}
