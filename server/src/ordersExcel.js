import ExcelJS from "exceljs";
import { pool } from "./db.js";
import { BRAND, PLATFORM } from "./brand.js";

// Builds the orders workbook from the live table: one row per order, with
// a balance formula and payment status. Cancelled orders are greyed out.

const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;
const AED_FORMAT = '#,##0.00 "AED"';
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6D365" } };
const CANCELLED_FONT = { color: { argb: "FF9A8F80" }, italic: true };

export function paymentStatus(order) {
  if (order.price > 0 && order.amount_paid >= order.price) return "Paid";
  if (order.amount_paid > 0) return "Part paid";
  return order.price > 0 ? "Unpaid" : "—";
}

export async function buildOrdersWorkbook({ statuses, sources, fulfilment }) {
  const { rows: orders } = await pool.query(
    `SELECT o.*, a.name AS arrangement_name
       FROM orders o LEFT JOIN arrangements a ON a.id = o.arrangement_id
      ORDER BY o.due_date DESC, o.due_time DESC, o.id DESC`
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${BRAND.name} · Powered by ${PLATFORM.name}`;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Orders", { views: [{ state: "frozen", ySplit: 3, xSplit: 1 }] });
  sheet.headerFooter.oddFooter = `&LPowered by ${PLATFORM.name}&RPage &P of &N`;
  sheet.columns = [
    { key: "order_number", width: 10 },
    { key: "status", width: 16 },
    { key: "due_date", width: 12, style: { numFmt: "dd mmm yyyy" } },
    { key: "due_time", width: 8 },
    { key: "customer_name", width: 22 },
    { key: "customer_phone", width: 16 },
    { key: "source", width: 11 },
    { key: "fulfilment", width: 10 },
    { key: "recipient_name", width: 18 },
    { key: "delivery_address", width: 30 },
    { key: "description", width: 34 },
    { key: "card_message", width: 28 },
    { key: "price", width: 13, style: { numFmt: AED_FORMAT } },
    { key: "amount_paid", width: 13, style: { numFmt: AED_FORMAT } },
    { key: "balance", width: 13, style: { numFmt: AED_FORMAT } },
    { key: "payment", width: 10 },
    { key: "arrangement_name", width: 24 },
    { key: "notes", width: 28 },
  ];

  const now = new Date(Date.now() + UAE_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
  sheet.getCell("A1").value = `${BRAND.name} — Orders`;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value = `As of ${now} (UAE time) · Powered by ${PLATFORM.name}`;
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF7A6A55" } };

  const header = sheet.getRow(3);
  header.values = [
    "Order",
    "Status",
    "Due date",
    "Time",
    "Customer",
    "Phone",
    "Source",
    "Delivery/Pickup",
    "Recipient",
    "Address",
    "Order details",
    "Card message",
    "Price",
    "Paid",
    "Balance",
    "Payment",
    "Arrangement",
    "Notes",
  ];
  header.font = { bold: true };
  header.fill = HEADER_FILL;

  for (const order of orders) {
    const [y, m, d] = order.due_date.split("-").map(Number);
    const row = sheet.addRow({
      ...order,
      status: statuses[order.status] ?? order.status,
      source: sources[order.source] ?? order.source,
      fulfilment: fulfilment[order.fulfilment] ?? order.fulfilment,
      due_date: new Date(Date.UTC(y, m - 1, d)),
      payment: paymentStatus(order),
    });
    row.getCell("balance").value = {
      formula: `M${row.number}-N${row.number}`,
      result: order.price - order.amount_paid,
    };
    row.alignment = { vertical: "top", wrapText: true };
    if (order.status === "cancelled") row.font = CANCELLED_FONT;
  }

  if (orders.length > 0) {
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: sheet.lastRow.number, column: 18 } };
  } else {
    sheet.addRow({ order_number: "No orders yet." });
  }
  return workbook;
}
