import { Router } from "express";
import { pool } from "../db.js";
import { BRAND } from "../brand.js";
import { StockError, adjustStock, inTransaction } from "../stock.js";
import { buildOrdersWorkbook } from "../ordersExcel.js";

// Pipeline order matters: the UI's "next step" button walks this list
// (pickup orders skip out_for_delivery).
export const STATUSES = {
  enquiry: "Enquiry",
  confirmed: "Confirmed",
  in_progress: "Being made",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const SOURCES = {
  walk_in: "Walk-in",
  phone: "Phone",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  website: "Website",
  other: "Other",
};

const FULFILMENT = { delivery: "Delivery", pickup: "Pickup" };

const router = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (value) => String(value ?? "").trim();

function validateOrder(body) {
  const errors = [];
  const order = {
    customer_name: text(body.customer_name),
    customer_phone: text(body.customer_phone),
    source: text(body.source) || "walk_in",
    status: text(body.status) || "enquiry",
    fulfilment: text(body.fulfilment) || "delivery",
    due_date: text(body.due_date),
    due_time: text(body.due_time),
    recipient_name: text(body.recipient_name),
    recipient_phone: text(body.recipient_phone),
    delivery_address: text(body.delivery_address),
    card_message: text(body.card_message),
    description: text(body.description),
    notes: text(body.notes),
    price: body.price === "" || body.price == null ? 0 : Number(body.price),
    amount_paid: body.amount_paid === "" || body.amount_paid == null ? 0 : Number(body.amount_paid),
    arrangement_id: body.arrangement_id === "" || body.arrangement_id == null ? null : Number(body.arrangement_id),
  };

  if (!order.customer_name) errors.push("Customer name is required.");
  if (!SOURCES[order.source]) errors.push("Unknown order source.");
  if (!STATUSES[order.status]) errors.push("Unknown status.");
  if (!FULFILMENT[order.fulfilment]) errors.push("Choose delivery or pickup.");
  if (!DATE.test(order.due_date) || Number.isNaN(Date.parse(order.due_date))) errors.push("Choose a due date.");
  if (order.due_time && !TIME.test(order.due_time)) errors.push("Time must be HH:MM.");
  if (!Number.isFinite(order.price) || order.price < 0) errors.push("Price must be a non-negative number.");
  if (!Number.isFinite(order.amount_paid) || order.amount_paid < 0) {
    errors.push("Amount paid must be a non-negative number.");
  }
  if (order.arrangement_id !== null && !Number.isInteger(order.arrangement_id)) {
    errors.push("Unknown arrangement.");
  }
  return { errors, order };
}

const COLUMNS = [
  "customer_name",
  "customer_phone",
  "source",
  "status",
  "fulfilment",
  "due_date",
  "due_time",
  "recipient_name",
  "recipient_phone",
  "delivery_address",
  "card_message",
  "description",
  "notes",
  "price",
  "amount_paid",
  "arrangement_id",
];

const ORDER_SELECT = `
  SELECT o.*, a.name AS arrangement_name, a.total_cost AS arrangement_cost
    FROM orders o
    LEFT JOIN arrangements a ON a.id = o.arrangement_id`;

async function fetchOrder(client, id) {
  const { rows } = await client.query(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (rows.length === 0) return null;
  const { rows: stationery } = await client.query(
    `SELECT id, item_id, item_name, -change AS quantity, created_at
       FROM inventory_movements WHERE order_id = $1 ORDER BY created_at, id`,
    [id]
  );
  return { ...rows[0], stationery };
}

// Turns a foreign-key failure on arrangement_id into a friendly message.
function isMissingArrangement(err) {
  return err.code === "23503" && String(err.constraint || "").includes("arrangement");
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${ORDER_SELECT} ORDER BY o.due_date, o.due_time, o.id`);
    res.json({ statuses: STATUSES, sources: SOURCES, orders: rows });
  } catch (err) {
    next(err);
  }
});

// Always generated from the live table, like the inventory export.
router.get("/export.xlsx", async (req, res, next) => {
  try {
    const workbook = await buildOrdersWorkbook({ statuses: STATUSES, sources: SOURCES, fulfilment: FULFILMENT });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="buttercup-blooms-orders-${stamp}.xlsx"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const order = await fetchOrder(pool, Number(req.params.id));
    if (!order) return res.status(404).json({ error: "Order not found." });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  const { errors, order } = validateOrder(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: errors.join(" ") });
  try {
    const created = await inTransaction(async (client) => {
      // Checked up front so a bad link doesn't burn an id (and leave a gap
      // in order numbers) by failing the INSERT.
      if (order.arrangement_id !== null) {
        const { rowCount } = await client.query("SELECT 1 FROM arrangements WHERE id = $1", [order.arrangement_id]);
        if (rowCount === 0) throw new StockError("That arrangement no longer exists.");
      }
      const values = COLUMNS.map((c) => order[c]);
      const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await client.query(
        `INSERT INTO orders (${COLUMNS.join(", ")}) VALUES (${placeholders}) RETURNING id`,
        values
      );
      const id = rows[0].id;
      await client.query("UPDATE orders SET order_number = $1 WHERE id = $2", [
        `${BRAND.orderPrefix}-${String(id).padStart(4, "0")}`,
        id,
      ]);
      return fetchOrder(client, id);
    });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof StockError) return res.status(err.status).json({ error: err.message });
    if (isMissingArrangement(err)) return res.status(400).json({ error: "That arrangement no longer exists." });
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  const { errors, order } = validateOrder(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: errors.join(" ") });
  try {
    const assignments = COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(", ");
    const { rowCount } = await pool.query(
      `UPDATE orders SET ${assignments}, updated_at = now() WHERE id = $${COLUMNS.length + 1}`,
      [...COLUMNS.map((c) => order[c]), id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Order not found." });
    res.json(await fetchOrder(pool, id));
  } catch (err) {
    if (isMissingArrangement(err)) return res.status(400).json({ error: "That arrangement no longer exists." });
    next(err);
  }
});

router.post("/:id/status", async (req, res, next) => {
  const id = Number(req.params.id);
  const status = text(req.body?.status);
  if (!STATUSES[status]) return res.status(400).json({ error: "Unknown status." });
  try {
    const { rowCount } = await pool.query("UPDATE orders SET status = $1, updated_at = now() WHERE id = $2", [
      status,
      id,
    ]);
    if (rowCount === 0) return res.status(404).json({ error: "Order not found." });
    res.json(await fetchOrder(pool, id));
  } catch (err) {
    next(err);
  }
});

// Records stationery used on the order and takes it out of inventory, in
// one transaction. The movement is labelled with the order number.
router.post("/:id/stationery", async (req, res, next) => {
  const id = Number(req.params.id);
  const itemId = Number(req.body?.item_id);
  const quantity = Number(req.body?.quantity);
  if (!Number.isInteger(itemId)) return res.status(400).json({ error: "Choose a stationery item." });
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be a whole number, 1 or more." });
  }
  try {
    const order = await inTransaction(async (client) => {
      const { rows } = await client.query("SELECT order_number FROM orders WHERE id = $1", [id]);
      if (rows.length === 0) throw new StockError("Order not found.", 404);
      await adjustStock(client, itemId, -quantity, `Used for order ${rows[0].order_number}`, id);
      await client.query("UPDATE orders SET updated_at = now() WHERE id = $1", [id]);
      return fetchOrder(client, id);
    });
    res.json(order);
  } catch (err) {
    if (err instanceof StockError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM orders WHERE id = $1", [Number(req.params.id)]);
    if (rowCount === 0) return res.status(404).json({ error: "Order not found." });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
