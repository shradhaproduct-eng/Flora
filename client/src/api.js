async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    // An expired or missing session anywhere in the app returns to the
    // login screen (App listens for this event).
    if (res.status === 401 && path !== "/auth/login") {
      window.dispatchEvent(new Event("auth:required"));
    }
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  getFlowers: () => request("/flowers"),
  createFlower: (flower) => request("/flowers", { method: "POST", body: JSON.stringify(flower) }),
  updateFlower: (id, flower) =>
    request(`/flowers/${id}`, { method: "PUT", body: JSON.stringify(flower) }),
  deleteFlower: (id) => request(`/flowers/${id}`, { method: "DELETE" }),
  uploadFlowersCsv: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/flowers/upload-csv", { method: "POST", body: form });
  },

  getSettings: () => request("/settings"),
  updateSettings: (settings) =>
    request("/settings", { method: "PUT", body: JSON.stringify(settings) }),

  getArrangements: () => request("/arrangements"),
  getArrangement: (id) => request(`/arrangements/${id}`),
  createArrangement: (arrangement) =>
    request("/arrangements", { method: "POST", body: JSON.stringify(arrangement) }),
  updateArrangement: (id, arrangement) =>
    request(`/arrangements/${id}`, { method: "PUT", body: JSON.stringify(arrangement) }),
  deleteArrangement: (id) => request(`/arrangements/${id}`, { method: "DELETE" }),

  askAssistant: (messages) => request("/agent", { method: "POST", body: JSON.stringify({ messages }) }),

  me: () => request("/auth/me"),
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  updateCredentials: (payload) => request("/auth/credentials", { method: "PUT", body: JSON.stringify(payload) }),

  getInventory: () => request("/inventory"),
  getInventoryMovements: () => request("/inventory/movements"),
  createInventoryItem: (item) => request("/inventory", { method: "POST", body: JSON.stringify(item) }),
  updateInventoryItem: (id, item) => request(`/inventory/${id}`, { method: "PUT", body: JSON.stringify(item) }),
  adjustInventoryItem: (id, change, reason) =>
    request(`/inventory/${id}/adjust`, { method: "POST", body: JSON.stringify({ change, reason }) }),
  deleteInventoryItem: (id) => request(`/inventory/${id}`, { method: "DELETE" }),
  identifyInventoryPhoto: (image) =>
    request("/inventory/identify", { method: "POST", body: JSON.stringify({ image }) }),
  inventoryExportUrl: "/api/inventory/export.xlsx",
};
