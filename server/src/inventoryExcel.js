import ExcelJS from "exceljs";
import { pool } from "./db.js";

// Builds the inventory workbook from the live tables: a Stock sheet (one
// row per item, with status and value) and a Movements sheet (the change
// history). Times are shown in UAE time (UTC+4, no daylight saving).

const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;
const toUaeTime = (date) => new Date(new Date(date).getTime() + UAE_OFFSET_MS);
const DATE_FORMAT = "dd mmm yyyy hh:mm";
const AED_FORMAT = '#,##0.00 "AED"';

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6D365" } };
const LOW_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E1" } };

function statusOf(item) {
  if (item.quantity === 0) return "Out of stock";
  if (item.quantity <= item.reorder_level) return "Low — reorder";
  return "OK";
}

function styleHeader(row) {
  row.font = { bold: true };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
}

export async function buildInventoryWorkbook(categories) {
  const [{ rows: items }, { rows: movements }] = await Promise.all([
    pool.query("SELECT * FROM inventory_items ORDER BY category, lower(name)"),
    pool.query("SELECT * FROM inventory_movements ORDER BY created_at DESC, id DESC LIMIT 5000"),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Buttercup Blooms";
  workbook.created = new Date();

  // --- Stock ---
  const stock = workbook.addWorksheet("Stock", { views: [{ state: "frozen", ySplit: 3 }] });
  stock.columns = [
    { key: "name", width: 34 },
    { key: "category", width: 16 },
    { key: "color", width: 18 },
    { key: "unit", width: 10 },
    { key: "quantity", width: 10 },
    { key: "reorder_level", width: 13 },
    { key: "status", width: 15 },
    { key: "unit_cost", width: 14, style: { numFmt: AED_FORMAT } },
    { key: "value", width: 15, style: { numFmt: AED_FORMAT } },
    { key: "notes", width: 30 },
    { key: "updated_at", width: 18, style: { numFmt: DATE_FORMAT } },
  ];

  stock.getCell("A1").value = "Buttercup Blooms — Stationery inventory";
  stock.getCell("A1").font = { bold: true, size: 14 };
  stock.getCell("A2").value = `As of ${toUaeTime(new Date()).toISOString().slice(0, 16).replace("T", " ")} (UAE time)`;
  stock.getCell("A2").font = { italic: true, color: { argb: "FF7A6A55" } };

  const header = stock.getRow(3);
  header.values = [
    "Item",
    "Category",
    "Colour",
    "Unit",
    "In stock",
    "Reorder at",
    "Status",
    "Unit cost",
    "Stock value",
    "Notes",
    "Last updated",
  ];
  styleHeader(header);

  for (const item of items) {
    const row = stock.addRow({
      name: item.name,
      category: categories[item.category] ?? item.category,
      color: item.color,
      unit: item.unit,
      quantity: item.quantity,
      reorder_level: item.reorder_level,
      status: statusOf(item),
      unit_cost: item.unit_cost,
      notes: item.notes,
      updated_at: toUaeTime(item.updated_at),
    });
    // A formula, so the value stays right if someone edits a count in Excel.
    if (item.unit_cost !== null) {
      row.getCell("value").value = { formula: `E${row.number}*H${row.number}`, result: item.quantity * item.unit_cost };
    }
    if (statusOf(item) !== "OK") row.fill = LOW_FILL;
  }

  if (items.length > 0) {
    const first = 4;
    const last = stock.lastRow.number;
    const totals = stock.addRow({ name: "Total stock value" });
    totals.font = { bold: true };
    totals.getCell("value").value = {
      formula: `SUM(I${first}:I${last})`,
      result: items.reduce((sum, i) => sum + (i.unit_cost ?? 0) * i.quantity, 0),
    };
    stock.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: 11 } };
  } else {
    stock.addRow({ name: "No items yet." });
  }

  // --- Movements ---
  const log = workbook.addWorksheet("Movements", { views: [{ state: "frozen", ySplit: 1 }] });
  log.columns = [
    { header: "Date", key: "created_at", width: 18, style: { numFmt: DATE_FORMAT } },
    { header: "Item", key: "item_name", width: 34 },
    { header: "Change", key: "change", width: 10, style: { numFmt: "+0;-0;0" } },
    { header: "Stock after", key: "quantity_after", width: 12 },
    { header: "Reason", key: "reason", width: 36 },
  ];
  styleHeader(log.getRow(1));
  for (const m of movements) {
    log.addRow({ ...m, created_at: toUaeTime(m.created_at) });
  }

  return workbook;
}
