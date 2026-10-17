import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import ArrangementBuilder from "./components/ArrangementBuilder.jsx";
import SavedArrangements from "./components/SavedArrangements.jsx";
import FlowerCatalog from "./components/FlowerCatalog.jsx";
import ArrangementAssistant from "./components/ArrangementAssistant.jsx";
import Inventory from "./components/Inventory.jsx";
import Login from "./components/Login.jsx";
import AccountSettings from "./components/AccountSettings.jsx";

const TABS = [
  { id: "builder", label: "Build Arrangement" },
  { id: "assistant", label: "Assistant" },
  { id: "saved", label: "Saved Arrangements" },
  { id: "inventory", label: "Inventory" },
  { id: "catalog", label: "Flower Catalog & Settings" },
];

// Gate: checks for an existing session, shows the login screen if there
// isn't one, and drops back to it whenever any request comes back 401.
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    const onAuthRequired = () => setUser(null);
    window.addEventListener("auth:required", onAuthRequired);
    return () => window.removeEventListener("auth:required", onAuthRequired);
  }, []);

  if (user === undefined) {
    return (
      <div className="app-shell">
        <p className="muted">Loading Buttercup Blooms…</p>
      </div>
    );
  }
  if (!user) return <Login api={api} onLoggedIn={setUser} />;
  return <MainApp user={user} setUser={setUser} />;
}

function MainApp({ user, setUser }) {
  const [tab, setTab] = useState("builder");
  const [flowers, setFlowers] = useState([]);
  const [settings, setSettings] = useState({ default_materials_cost: 0, default_markup_multiplier: 1 });
  const [arrangements, setArrangements] = useState([]);
  const [editingArrangement, setEditingArrangement] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assistantConversation, setAssistantConversation] = useState({ history: [], transcript: [] });

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

  // A proposal has no id, so the builder opens it as a new, unsaved
  // arrangement the user can tweak before saving.
  function handleOpenProposal(proposal) {
    setEditingArrangement({
      name: proposal.name,
      items: proposal.items,
      materials_cost: proposal.materials_cost,
      markup_multiplier: proposal.markup_multiplier,
    });
    setTab("builder");
  }

  async function handleLogout() {
    await api.logout().catch(() => {});
    setUser(null);
  }

  async function handleSaved() {
    await refreshArrangements();
    setEditingArrangement(null);
  }

  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">Loading Buttercup Blooms…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            🌼
          </span>
          <div>
            <h1>Buttercup Blooms</h1>
            <p className="muted">Arrangement costing, design &amp; stationery inventory</p>
          </div>
        </div>
        <div className="account">
          <span className="muted">{user.username}</span>
          <button type="button" className="btn-link" onClick={handleLogout}>
            Sign out
          </button>
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
        {tab === "assistant" && (
          <ArrangementAssistant
            api={api}
            conversation={assistantConversation}
            setConversation={setAssistantConversation}
            onOpenProposal={handleOpenProposal}
            notify={notify}
          />
        )}
        {tab === "saved" && (
          <SavedArrangements arrangements={arrangements} onEdit={handleEdit} onDelete={handleDelete} />
        )}
        {tab === "inventory" && <Inventory api={api} notify={notify} />}
        {tab === "catalog" && (
          <>
            <FlowerCatalog
              flowers={flowers}
              settings={settings}
              api={api}
              refreshFlowers={refreshFlowers}
              refreshSettings={refreshSettings}
              notify={notify}
            />
            <AccountSettings api={api} user={user} onUpdated={setUser} notify={notify} />
          </>
        )}
      </main>
    </div>
  );
}
