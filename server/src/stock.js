import { pool } from "./db.js";

// Shared stock-keeping used by the Inventory tab and by orders, so every
// change to stationery stock goes through the same rules and lands in the
// movement log.

// A stock change that can't be applied (unknown item, not enough stock);
// the message is safe to show to the user.
export class StockError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Runs fn inside a transaction on a dedicated client.
export async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function logMovement(client, item, change, reason, orderId = null) {
  await client.query(
    `INSERT INTO inventory_movements (item_id, item_name, change, quantity_after, reason, order_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [item.id, item.name, change, item.quantity, reason, orderId]
  );
}

// Adds (change > 0) or removes (change < 0) stock. Refuses to go below
// zero rather than silently clamping. Must run inside a transaction.
export async function adjustStock(client, itemId, change, reason, orderId = null) {
  const { rows } = await client.query(
    `UPDATE inventory_items SET quantity = quantity + $1, updated_at = now()
     WHERE id = $2 AND quantity + $1 >= 0 RETURNING *`,
    [change, itemId]
  );
  if (rows.length === 0) {
    const { rows: existing } = await client.query("SELECT name, quantity, unit FROM inventory_items WHERE id = $1", [
      itemId,
    ]);
    if (existing.length === 0) throw new StockError("Item not found.", 404);
    const { name, quantity, unit } = existing[0];
    throw new StockError(`Only ${quantity} ${unit} of ${name} in stock — can't remove ${-change}.`);
  }
  await logMovement(client, rows[0], change, reason, orderId);
  return rows[0];
}
