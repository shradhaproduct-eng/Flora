import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency, resizeImage } from "../utils.js";

const CATEGORY_ICONS = {
  wrapping_paper: "🎁",
  ribbon: "🎀",
  bloom_bag: "🛍️",
  greeting_card: "💌",
  tag: "🏷️",
  other: "📦",
};
const UNITS = ["pcs", "rolls", "sheets", "packs", "metres"];
const THUMB_SIZE = 320;
const IDENTIFY_SIZE = 1280;

const emptyForm = () => ({
  name: "",
  category: "ribbon",
  color: "",
  unit: "pcs",
  quantity: 0,
  reorder_level: 0,
  unit_cost: "",
  notes: "",
  image: null,
});

function stockStatus(item) {
  if (item.quantity === 0) return { label: "Out of stock", tone: "out" };
  if (item.quantity <= item.reorder_level) return { label: "Low", tone: "low" };
  return { label: "In stock", tone: "ok" };
}

export default function Inventory({ api, notify }) {
  const [categories, setCategories] = useState({});
  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState(null); // null = closed; has id when editing
  const [identify, setIdentify] = useState(null);
  const [amounts, setAmounts] = useState({});

  const refresh = useCallback(async () => {
    const [inventory, recent] = await Promise.all([api.getInventory(), api.getInventoryMovements()]);
    setCategories(inventory.categories);
    setItems(inventory.items);
    setMovements(recent);
  }, [api]);

  useEffect(() => {
    refresh().catch((err) => notify(err.message, "error"));
  }, [refresh, notify]);

  const lowCount = items.filter((item) => stockStatus(item).tone !== "ok").length;
  const visible = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "low") return items.filter((item) => stockStatus(item).tone !== "ok");
    return items.filter((item) => item.category === filter);
  }, [items, filter]);

  async function adjust(item, direction, amountOverride) {
    const amount = Number(amountOverride ?? amounts[item.id] ?? 1);
    if (!Number.isInteger(amount) || amount <= 0) {
      notify("Enter a whole number to add or use.", "error");
      return false;
    }
    try {
      await api.adjustInventoryItem(item.id, direction * amount, direction > 0 ? "Stock added" : "Stock used");
      await refresh();
      notify(`${direction > 0 ? "Added" : "Used"} ${amount} ${item.unit} — ${item.name}.`, "success");
      return true;
    } catch (err) {
      notify(err.message, "error");
      return false;
    }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.name}" from inventory? Its history stays in the Excel export.`)) return;
    try {
      await api.deleteInventoryItem(item.id);
      await refresh();
      notify(`Deleted "${item.name}".`, "success");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const payload = {
      ...form,
      quantity: Number(form.quantity) || 0,
      reorder_level: Number(form.reorder_level) || 0,
      unit_cost: form.unit_cost === "" || form.unit_cost === null ? null : Number(form.unit_cost),
    };
    try {
      if (form.id) await api.updateInventoryItem(form.id, payload);
      else await api.createInventoryItem(payload);
      await refresh();
      notify(`Saved "${payload.name}".`, "success");
      setForm(null);
      setIdentify(null);
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleFormPhoto(file) {
    if (!file) return;
    try {
      const image = await resizeImage(file, THUMB_SIZE, 0.8);
      setForm((prev) => ({ ...prev, image }));
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleIdentifyPhoto(file) {
    if (!file) return;
    setForm(null);
    try {
      const [thumb, full] = await Promise.all([
        resizeImage(file, THUMB_SIZE, 0.8),
        resizeImage(file, IDENTIFY_SIZE, 0.85),
      ]);
      setIdentify({ status: "loading", thumb });
      try {
        const result = await api.identifyInventoryPhoto(full);
        setIdentify({ status: "done", thumb, result, amount: result.estimated_count || 1 });
      } catch (err) {
        setIdentify({ status: "error", thumb, error: err.message });
      }
    } catch (err) {
      notify(err.message, "error");
    }
  }

  function addFromPhoto() {
    const r = identify.result;
    setForm({
      ...emptyForm(),
      ...(r && {
        name: r.suggested_name,
        category: r.category,
        color: r.color,
        unit: r.suggested_unit || "pcs",
        quantity: r.estimated_count ?? 0,
      }),
      image: identify.thumb,
    });
    setIdentify(null);
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-header wrap">
          <h2>Stationery Inventory ({items.length})</h2>
          <div className="toolbar">
            <label className="btn-secondary file-btn">
              📷 Identify from photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  handleIdentifyPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <a className="btn-secondary" href={api.inventoryExportUrl} download>
              ⬇ Download Excel
            </a>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setIdentify(null);
                setForm(emptyForm());
              }}
            >
              + Add item
            </button>
          </div>
        </div>
        <p className="muted">
          Wrapping paper, ribbons, bloom bags, greeting cards and tags. The Excel download is built from live stock
          every time, so it's always up to date.
        </p>

        <div className="filter-chips" role="tablist">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All ({items.length})
          </FilterChip>
          {Object.entries(categories).map(([key, label]) => {
            const count = items.filter((item) => item.category === key).length;
            if (count === 0) return null;
            return (
              <FilterChip key={key} active={filter === key} onClick={() => setFilter(key)}>
                {CATEGORY_ICONS[key]} {label} ({count})
              </FilterChip>
            );
          })}
          {lowCount > 0 && (
            <FilterChip active={filter === "low"} onClick={() => setFilter("low")} tone="warn">
              ⚠ Low stock ({lowCount})
            </FilterChip>
          )}
        </div>

        {identify && (
          <IdentifyPanel
            identify={identify}
            setIdentify={setIdentify}
            onAdjust={async (item, direction) => {
              if (await adjust(item, direction, identify.amount)) setIdentify(null);
            }}
            onAddNew={addFromPhoto}
          />
        )}

        {form && (
          <ItemForm
            form={form}
            setForm={setForm}
            categories={categories}
            onPhoto={handleFormPhoto}
            onSubmit={handleSave}
            onCancel={() => setForm(null)}
          />
        )}

        {items.length === 0 && !form ? (
          <p className="empty-state">
            No stationery yet. Add your first item, or take a photo of something on the shelf and let the app
            identify it.
          </p>
        ) : (
          <ul className="inventory-list">
            {visible.map((item) => {
              const status = stockStatus(item);
              return (
                <li key={item.id} className={`inventory-row status-${status.tone}`}>
                  <Thumb item={item} />
                  <div className="inventory-info">
                    <strong>{item.name}</strong>
                    <span className="muted">
                      {categories[item.category] ?? item.category}
                      {item.color && ` · ${item.color}`}
                      {item.unit_cost !== null && ` · ${formatCurrency(item.unit_cost)} each`}
                    </span>
                    <span className={`badge badge-${status.tone}`}>
                      {status.label}
                      {status.tone !== "ok" && item.reorder_level > 0 && ` · reorder at ${item.reorder_level}`}
                    </span>
                  </div>
                  <div className="inventory-qty">
                    <span className="qty-number">{item.quantity}</span>
                    <span className="muted">{item.unit}</span>
                  </div>
                  <div className="inventory-actions">
                    <div className="adjust">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        aria-label={`Amount for ${item.name}`}
                        value={amounts[item.id] ?? 1}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      />
                      <button type="button" className="btn-secondary" onClick={() => adjust(item, 1)}>
                        + Add
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => adjust(item, -1)}
                        disabled={item.quantity === 0}
                      >
                        − Use
                      </button>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => {
                          setIdentify(null);
                          setForm({ ...item, unit_cost: item.unit_cost ?? "" });
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="btn-link danger" onClick={() => handleDelete(item)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {movements.length > 0 && (
        <section className="card">
          <h2>Recent stock changes</h2>
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Item</th>
                <th>Change</th>
                <th className="hide-mobile">Reason</th>
              </tr>
            </thead>
            <tbody>
              {movements.slice(0, 10).map((m) => (
                <tr key={m.id}>
                  <td className="muted">
                    {new Date(m.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>{m.item_name}</td>
                  <td className={m.change > 0 ? "profit-positive" : "profit-negative"}>
                    {m.change > 0 ? `+${m.change}` : m.change} → {m.quantity_after}
                  </td>
                  <td className="muted hide-mobile">{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, tone, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`chip ${active ? "active" : ""} ${tone === "warn" ? "chip-warn" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Thumb({ item, src }) {
  const image = src ?? item?.image;
  return image ? (
    <img className="thumb" src={image} alt="" />
  ) : (
    <span className="thumb thumb-placeholder" aria-hidden="true">
      {CATEGORY_ICONS[item?.category] ?? "📦"}
    </span>
  );
}

function IdentifyPanel({ identify, setIdentify, onAdjust, onAddNew }) {
  const { status, thumb, result, error } = identify;
  const matched = result?.matched_item;

  return (
    <div className="identify-panel">
      <Thumb src={thumb} />
      <div className="identify-body">
        {status === "loading" && <p className="muted">Identifying…</p>}

        {status === "error" && (
          <>
            <p className="form-error">{error}</p>
            <div className="toolbar">
              <button type="button" className="btn-secondary" onClick={onAddNew}>
                Add as new item with this photo
              </button>
              <button type="button" className="btn-link" onClick={() => setIdentify(null)}>
                Dismiss
              </button>
            </div>
          </>
        )}

        {status === "done" && (
          <>
            {!result.is_stationery && (
              <p className="form-error">This doesn't look like florist stationery — check the photo.</p>
            )}
            <p>
              {matched ? (
                <>
                  Looks like <strong>{matched.name}</strong> — {matched.quantity} {matched.unit} in stock
                  {result.match_confidence !== "high" && (
                    <span className="muted"> ({result.match_confidence} confidence)</span>
                  )}
                  .
                </>
              ) : (
                <>
                  New item: <strong>{result.suggested_name}</strong>
                </>
              )}
            </p>
            <p className="muted">{result.description}</p>

            {matched ? (
              <div className="toolbar">
                <div className="adjust">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    aria-label="Amount"
                    value={identify.amount}
                    onChange={(e) => setIdentify({ ...identify, amount: e.target.value })}
                  />
                  <button type="button" className="btn-primary" onClick={() => onAdjust(matched, 1)}>
                    + Add to stock
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onAdjust(matched, -1)}
                    disabled={matched.quantity === 0}
                  >
                    − Use
                  </button>
                </div>
                <button type="button" className="btn-link" onClick={onAddNew}>
                  Not this — add as a new item
                </button>
              </div>
            ) : (
              <div className="toolbar">
                <button type="button" className="btn-primary" onClick={onAddNew}>
                  Add as new item
                </button>
                <button type="button" className="btn-link" onClick={() => setIdentify(null)}>
                  Dismiss
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ItemForm({ form, setForm, categories, onPhoto, onSubmit, onCancel }) {
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <form className="item-form" onSubmit={onSubmit}>
      <h3>{form.id ? `Edit ${form.name}` : "New item"}</h3>
      <div className="item-form-photo">
        <Thumb item={form} />
        <label className="btn-secondary file-btn">
          {form.image ? "Replace photo" : "Add photo"}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              onPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {form.image && (
          <button type="button" className="btn-link danger" onClick={() => setForm((prev) => ({ ...prev, image: null }))}>
            Remove photo
          </button>
        )}
      </div>

      <div className="grid-2">
        <label className="field span-2">
          <span>Name</span>
          <input type="text" value={form.name} onChange={set("name")} placeholder="e.g. Blush satin ribbon 2.5cm" />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={form.category} onChange={set("category")}>
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Colour</span>
          <input type="text" value={form.color} onChange={set("color")} placeholder="e.g. blush pink" />
        </label>
        <label className="field">
          <span>{form.id ? "In stock (stock count)" : "Starting stock"}</span>
          <input type="number" min="0" step="1" value={form.quantity} onChange={set("quantity")} />
        </label>
        <label className="field">
          <span>Counted in</span>
          <input type="text" list="inventory-units" value={form.unit} onChange={set("unit")} />
          <datalist id="inventory-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Reorder when at or below</span>
          <input type="number" min="0" step="1" value={form.reorder_level} onChange={set("reorder_level")} />
        </label>
        <label className="field">
          <span>Unit cost (optional)</span>
          <div className="prefixed-input">
            <span>AED</span>
            <input type="number" min="0" step="0.01" value={form.unit_cost} onChange={set("unit_cost")} />
          </div>
        </label>
        <label className="field span-2">
          <span>Notes</span>
          <input type="text" value={form.notes} onChange={set("notes")} placeholder="Supplier, size, shelf…" />
        </label>
      </div>
      <div className="card-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!form.name.trim()}>
          {form.id ? "Save changes" : "Add item"}
        </button>
      </div>
    </form>
  );
}
