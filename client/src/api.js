async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
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
};
