import { formatCurrency } from "../utils.js";

export default function SavedArrangements({ arrangements, onEdit, onDelete }) {
  if (arrangements.length === 0) {
    return (
      <div className="card">
        <h2>Saved Arrangements</h2>
        <p className="muted">No arrangements saved yet. Build one and hit "Save arrangement".</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Saved Arrangements ({arrangements.length})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Cost</th>
              <th>Selling price</th>
              <th>Profit</th>
              <th>Saved</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {arrangements.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{formatCurrency(a.total_cost)}</td>
                <td>{formatCurrency(a.selling_price)}</td>
                <td className={a.profit >= 0 ? "profit-positive" : "profit-negative"}>
                  {formatCurrency(a.profit)}
                </td>
                <td className="muted">{new Date(a.updated_at + "Z").toLocaleDateString()}</td>
                <td className="row-actions">
                  <button className="btn-link" onClick={() => onEdit(a.id)}>
                    Edit
                  </button>
                  <button className="btn-link danger" onClick={() => onDelete(a.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
