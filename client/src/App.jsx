import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import ArrangementBuilder from "./components/ArrangementBuilder.jsx";
import SavedArrangements from "./components/SavedArrangements.jsx";
import FlowerCatalog from "./components/FlowerCatalog.jsx";

const TABS = [
  { id: "builder", label: "Build Arrangement" },
  { id: "saved", label: "Saved Arrangements" },
  { id: "catalog", label: "Flower Catalog & Settings" },
];

export default function App() {
  const [tab, setTab] = useState("builder");
  const [flowers, setFlowers] = useState([]);
  const [settings, setSettings] = useState({ default_materials_cost: 0, default_markup_multiplier: 1 });
  const [arrangements, setArrangements] = useState([]);
  const [editingArrangement, setEditingArrangement] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const notify = useCallback((message, kind = "success") => {
    setToast({ message, kind });
    window.clearTimeout(notify._t);
    notify._t = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshFlowers = useCallback(async () => setFlowers(await api.getFlowers()), []);
  const refreshSettings = useCallback(async () => setSettings(await api.getSettings()), []);
  const refreshArrangements = useCallback(async () => setArrangements(await api.getArrangements()), []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([refreshFlowers(), refreshSettings(), refreshArrangements()]);
      } catch (err) {
        notify(err.message, "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshFlowers, refreshSettings, refreshArrangements, notify]);

  async function handleEdit(id) {
    try {
      const arrangement = await api.getArrangement(id);
      setEditingArrangement(arrangement);
      setTab("builder");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this saved arrangement?")) return;
    try {
      await api.deleteArrangement(id);
      await refreshArrangements();
      if (editingArrangement?.id === id) setEditingArrangement(null);
      notify("Arrangement deleted.", "success");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleSaved() {
    await refreshArrangements();
    setEditingArrangement(null);
  }

  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">Loading Flora…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>🌸 Flora</h1>
          <p className="muted">Flower cost calculator &amp; arrangement builder</p>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.message}</div>}

      <main>
        {tab === "builder" && (
          <ArrangementBuilder
            flowers={flowers}
            settings={settings}
            api={api}
            editingArrangement={editingArrangement}
            onSaved={handleSaved}
            onStartNew={() => setEditingArrangement(null)}
            notify={notify}
          />
        )}
        {tab === "saved" && (
          <SavedArrangements arrangements={arrangements} onEdit={handleEdit} onDelete={handleDelete} />
        )}
        {tab === "catalog" && (
          <FlowerCatalog
            flowers={flowers}
            settings={settings}
            api={api}
            refreshFlowers={refreshFlowers}
            refreshSettings={refreshSettings}
            notify={notify}
          />
        )}
      </main>
    </div>
  );
}
