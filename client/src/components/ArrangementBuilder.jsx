import { useEffect, useMemo, useState } from "react";
import { formatCurrency, generateDefaultName, emptyItem } from "../utils.js";

export default function ArrangementBuilder({
  flowers,
  settings,
  api,
  editingArrangement,
  onSaved,
  onStartNew,
  notify,
}) {
  // `name` only ever holds a user-typed override. While the user hasn't
  // touched the field (nameTouched === false), the displayed name is
  // derived fresh from the current flowers on every render — see
  // `displayedName` below — so there's no risk of two effects racing to
  // set the same piece of state (which previously clobbered a loaded
  // arrangement's saved name with a freshly generated default).
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [items, setItems] = useState([emptyItem()]);
  const [materialsCost, setMaterialsCost] = useState(settings.default_materials_cost);
  const [markupMultiplier, setMarkupMultiplier] = useState(settings.default_markup_multiplier);
  const [saving, setSaving] = useState(false);
  const editingId = editingArrangement?.id ?? null;

  const defaultName = useMemo(() => generateDefaultName(items), [items]);
  const displayedName = nameTouched ? name : defaultName;

  // Load an arrangement into the form when the user picks "Edit" from the
  // saved list; otherwise reset to a fresh form pre-filled with the current
  // global defaults for materials/extras and markup.
  useEffect(() => {
    if (editingArrangement) {
      setName(editingArrangement.name);
      setNameTouched(true);
      setItems(
        editingArrangement.items.length > 0
          ? editingArrangement.items.map((item) => ({
              key: crypto.randomUUID(),
              flower_id: item.flower_id,
              flower_name: item.flower_name,
              stem_price: item.stem_price,
              stems: item.stems,
            }))
          : [emptyItem()]
      );
      setMaterialsCost(editingArrangement.materials_cost);
      setMarkupMultiplier(editingArrangement.markup_multiplier);
    } else {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingArrangement]);

  function resetForm() {
    setItems([emptyItem()]);
    setMaterialsCost(settings.default_materials_cost);
    setMarkupMultiplier(settings.default_markup_multiplier);
    setNameTouched(false);
    setName("");
  }

  function updateItem(key, patch) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function handleFlowerChange(key, flowerId) {
    const flower = flowers.find((f) => f.id === Number(flowerId));
    updateItem(key, {
      flower_id: flower?.id ?? null,
      flower_name: flower?.name ?? "",
      stem_price: flower?.stem_price ?? 0,
    });
  }

  function addRow() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeRow(key) {
    setItems((prev) => (prev.length > 1 ? prev.filter((item) => item.key !== key) : prev));
  }

  const totals = useMemo(() => {
    const stemsCost = items.reduce(
      (sum, item) => sum + (Number(item.stem_price) || 0) * (Number(item.stems) || 0),
      0
    );
    const totalCost = stemsCost + (Number(materialsCost) || 0);
    const sellingPrice = totalCost * (Number(markupMultiplier) || 0);
    const profit = sellingPrice - totalCost;
    return { stemsCost, totalCost, sellingPrice, profit };
  }, [items, materialsCost, markupMultiplier]);

  async function handleSave(e) {
    e.preventDefault();
    const payload = {
      name: displayedName.trim() || defaultName,
      items: items.filter((item) => item.flower_name && Number(item.stems) > 0),
      materials_cost: Number(materialsCost) || 0,
      markup_multiplier: Number(markupMultiplier) || 0,
    };
    if (payload.items.length === 0) {
      notify("Add at least one flower with a stem count before saving.", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = editingId
        ? await api.updateArrangement(editingId, payload)
        : await api.createArrangement(payload);
      notify(`Saved "${saved.name}".`, "success");
      onSaved(saved);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSave}>
      <div className="card-header">
        <h2>{editingId ? "Edit Arrangement" : "New Arrangement"}</h2>
        {editingId && (
          <button type="button" className="btn-link" onClick={onStartNew}>
            + Start a new arrangement
          </button>
        )}
      </div>

      <label className="field">
        <span>Arrangement name</span>
        <div className="input-with-action">
          <input
            type="text"
            value={displayedName}
            placeholder="e.g. Rose & Tulip Bouquet"
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            title="Clear the name and regenerate the default from selected flowers"
            onClick={() => {
              setNameTouched(false);
              setName("");
            }}
          >
            Clear
          </button>
        </div>
      </label>

      <div className="field">
        <span>Flowers &amp; stems</span>
        <div className="item-rows">
          {items.map((item) => (
            <div className="item-row" key={item.key}>
              <select
                value={item.flower_id ?? ""}
                onChange={(e) => handleFlowerChange(item.key, e.target.value)}
              >
                <option value="" disabled>
                  Choose a flower…
                </option>
                {flowers.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {formatCurrency(f.stem_price)}/stem
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="1"
                className="stems-input"
                value={item.stems}
                onChange={(e) => updateItem(item.key, { stems: e.target.value })}
              />
              <span className="row-subtotal">
                {formatCurrency((Number(item.stem_price) || 0) * (Number(item.stems) || 0))}
              </span>
              <button
                type="button"
                className="btn-icon"
                aria-label="Remove flower"
                onClick={() => removeRow(item.key)}
                disabled={items.length === 1}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-link" onClick={addRow}>
          + Add another flower
        </button>
      </div>

      <div className="grid-2">
        <label className="field">
          <span>Materials &amp; extras cost</span>
          <div className="input-with-action">
            <div className="prefixed-input">
              <span>AED</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={materialsCost}
                onChange={(e) => setMaterialsCost(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-secondary"
              title="Reset to the global default"
              onClick={() => setMaterialsCost(settings.default_materials_cost)}
            >
              Reset
            </button>
          </div>
          <small>Default: {formatCurrency(settings.default_materials_cost)} (editable in Settings)</small>
        </label>

        <label className="field">
          <span>Markup multiplier</span>
          <div className="input-with-action">
            <div className="prefixed-input">
              <span>×</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={markupMultiplier}
                onChange={(e) => setMarkupMultiplier(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-secondary"
              title="Reset to the global default"
              onClick={() => setMarkupMultiplier(settings.default_markup_multiplier)}
            >
              Reset
            </button>
          </div>
          <small>Default: {settings.default_markup_multiplier}× (editable in Settings)</small>
        </label>
      </div>

      <div className="summary">
        <div className="summary-row">
          <span>Stems cost</span>
          <span>{formatCurrency(totals.stemsCost)}</span>
        </div>
        <div className="summary-row">
          <span>Materials &amp; extras</span>
          <span>{formatCurrency(Number(materialsCost) || 0)}</span>
        </div>
        <div className="summary-row total">
          <span>Total cost</span>
          <span>{formatCurrency(totals.totalCost)}</span>
        </div>
        <div className="summary-row highlight">
          <span>Potential selling price</span>
          <span>{formatCurrency(totals.sellingPrice)}</span>
        </div>
        <div className="summary-row profit">
          <span>Profit</span>
          <span>{formatCurrency(totals.profit)}</span>
        </div>
      </div>

      <div className="card-actions">
        <button type="button" className="btn-secondary" onClick={resetForm}>
          Clear arrangement
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : editingId ? "Update arrangement" : "Save arrangement"}
        </button>
      </div>
    </form>
  );
}
