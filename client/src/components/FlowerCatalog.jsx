import { useRef, useState } from "react";
import { formatCurrency } from "../utils.js";

export default function FlowerCatalog({ flowers, settings, api, refreshFlowers, refreshSettings, notify }) {
  const [newFlower, setNewFlower] = useState({ name: "", stem_price: "" });
  const [edits, setEdits] = useState({});
  const [materialsDefault, setMaterialsDefault] = useState(settings.default_materials_cost);
  const [markupDefault, setMarkupDefault] = useState(settings.default_markup_multiplier);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  async function handleAddFlower(e) {
    e.preventDefault();
    const price = Number(newFlower.stem_price);
    if (!newFlower.name.trim() || !Number.isFinite(price) || price < 0) {
      notify("Enter a flower name and a valid non-negative stem price.", "error");
      return;
    }
    try {
      await api.createFlower({ name: newFlower.name.trim(), stem_price: price });
      setNewFlower({ name: "", stem_price: "" });
      await refreshFlowers();
      notify(`Added "${newFlower.name.trim()}".`, "success");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleUpdateFlower(flower) {
    const patch = edits[flower.id];
    if (!patch) return;
    try {
      await api.updateFlower(flower.id, {
        name: patch.name ?? flower.name,
        stem_price: patch.stem_price ?? flower.stem_price,
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[flower.id];
        return next;
      });
      await refreshFlowers();
      notify("Flower updated.", "success");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleDeleteFlower(flower) {
    if (!confirm(`Delete "${flower.name}" from the catalog?`)) return;
    try {
      await api.deleteFlower(flower.id);
      await refreshFlowers();
      notify(`Deleted "${flower.name}".`, "success");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.uploadFlowersCsv(file);
      await refreshFlowers();
      const message =
        result.errors.length > 0
          ? `Imported ${result.imported} flowers, skipped ${result.errors.length} invalid row(s).`
          : `Imported ${result.imported} flowers.`;
      notify(message, result.errors.length > 0 ? "error" : "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    try {
      await api.updateSettings({
        default_materials_cost: Number(materialsDefault),
        default_markup_multiplier: Number(markupDefault),
      });
      await refreshSettings();
      notify("Global defaults updated. New arrangements will use these.", "success");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h2>Global Defaults</h2>
        <p className="muted">
          These act as universal constants that pre-fill every new arrangement's materials/extras
          cost and markup multiplier. Each arrangement can still override them individually.
        </p>
        <form className="grid-2" onSubmit={handleSaveSettings}>
          <label className="field">
            <span>Default materials &amp; extras cost</span>
            <div className="prefixed-input">
              <span>AED</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={materialsDefault}
                onChange={(e) => setMaterialsDefault(e.target.value)}
              />
            </div>
          </label>
          <label className="field">
            <span>Default markup multiplier</span>
            <div className="prefixed-input">
              <span>×</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={markupDefault}
                onChange={(e) => setMarkupDefault(e.target.value)}
              />
            </div>
          </label>
          <div className="card-actions span-2">
            <button type="submit" className="btn-primary">
              Save defaults
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Flower Catalog ({flowers.length})</h2>
          <label className="btn-secondary file-btn">
            {uploading ? "Uploading…" : "Upload CSV"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvUpload}
              hidden
            />
          </label>
        </div>
        <p className="muted">
          One-time bulk load: upload a CSV with <code>name,stem_price</code> columns. Re-uploading
          updates prices for matching names and adds any new ones.
        </p>

        <form className="item-row add-flower-row" onSubmit={handleAddFlower}>
          <input
            type="text"
            placeholder="New flower name"
            value={newFlower.name}
            onChange={(e) => setNewFlower((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="prefixed-input">
            <span>AED</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Stem price"
              value={newFlower.stem_price}
              onChange={(e) => setNewFlower((f) => ({ ...f, stem_price: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn-secondary">
            + Add
          </button>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Stem price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flowers.map((flower) => {
                const edit = edits[flower.id] || {};
                return (
                  <tr key={flower.id}>
                    <td>
                      <input
                        type="text"
                        value={edit.name ?? flower.name}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [flower.id]: { ...prev[flower.id], name: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <div className="prefixed-input">
                        <span>AED</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={edit.stem_price ?? flower.stem_price}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [flower.id]: { ...prev[flower.id], stem_price: e.target.value },
                            }))
                          }
                        />
                      </div>
                    </td>
                    <td className="row-actions">
                      <button className="btn-link" onClick={() => handleUpdateFlower(flower)}>
                        Save
                      </button>
                      <button className="btn-link danger" onClick={() => handleDeleteFlower(flower)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {flowers.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No flowers yet — add one above or upload a CSV.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
