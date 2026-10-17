// The shop this deployment is branded for, plus the Flora platform credit.
// Every customer-facing name, mark and tagline in the UI comes from here,
// so white-labelling for another shop means changing only this file (and
// server/src/brand.js). When Flora becomes multi-tenant, this is the shape
// to load per tenant instead.
export const BRAND = {
  name: "Buttercup Blooms",
  mark: "🌼",
  tagline: "Arrangement costing, design & stationery inventory",
};

export const PLATFORM = {
  name: "Flora",
  mark: "🌸",
};
