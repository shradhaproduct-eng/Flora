import { useState } from "react";

// Change the single login's username and/or password. Saving a new
// password signs out every other browser.
export default function AccountSettings({ api, user, onUpdated, notify }) {
  const [form, setForm] = useState({ new_username: user.username, new_password: "", confirm: "", current_password: "" });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.new_password !== form.confirm) {
      notify("The new passwords don't match.", "error");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateCredentials({
        current_password: form.current_password,
        new_username: form.new_username,
        new_password: form.new_password,
      });
      onUpdated(updated);
      setForm({ new_username: updated.username, new_password: "", confirm: "", current_password: "" });
      notify("Login details updated.", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Login</h2>
      <p className="muted">Change the username or password used to sign in. Leave the new password blank to keep it.</p>
      <div className="grid-2">
        <label className="field">
          <span>Username</span>
          <input type="text" autoComplete="username" value={form.new_username} onChange={set("new_username")} />
        </label>
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={form.current_password}
            onChange={set("current_password")}
          />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={form.new_password} onChange={set("new_password")} />
          <small>At least 8 characters.</small>
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
        </label>
        <div className="card-actions span-2">
          <button type="submit" className="btn-primary" disabled={saving || !form.current_password}>
            {saving ? "Saving…" : "Save login details"}
          </button>
        </div>
      </div>
    </form>
  );
}
