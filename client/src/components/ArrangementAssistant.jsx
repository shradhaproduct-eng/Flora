import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "../utils.js";

const EXAMPLES = [
  "A pink and white bridal bouquet, around 25 stems, selling for about $90",
  "Cheapest bouquet I can sell for $50 with at least $30 profit",
  "A cheaper version of my most recent saved arrangement",
];

// Chat with the arrangement assistant. The conversation lives in App (via
// `conversation` / `setConversation`) so it survives switching tabs:
// `history` is the API-format message list the server hands back each
// turn, `transcript` is what's rendered here.
export default function ArrangementAssistant({ api, conversation, setConversation, onOpenProposal, notify }) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef(null);
  const { history, transcript } = conversation;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript.length, pending]);

  async function send(text) {
    const message = text.trim();
    if (!message || pending) return;
    const nextHistory = [...history, { role: "user", content: message }];
    setConversation({ history, transcript: [...transcript, { role: "user", text: message }] });
    setInput("");
    setPending(true);
    try {
      const result = await api.askAssistant(nextHistory);
      setConversation({
        history: result.messages,
        transcript: [
          ...transcript,
          { role: "user", text: message },
          { role: "assistant", text: result.reply, proposals: result.proposals },
        ],
      });
    } catch (err) {
      // Roll back so the failed message can be edited and re-sent.
      setConversation({ history, transcript });
      setInput(message);
      notify(err.message, "error");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <section className="card assistant">
      <div className="card-header">
        <h2>Arrangement Assistant</h2>
        {transcript.length > 0 && (
          <button
            type="button"
            className="btn-link"
            disabled={pending}
            onClick={() => setConversation({ history: [], transcript: [] })}
          >
            New conversation
          </button>
        )}
      </div>

      {transcript.length === 0 ? (
        <div className="assistant-intro">
          <p className="muted">
            Describe what you need — style, size, budget, profit target — and the assistant will pick flowers from your
            catalog, check the numbers, and propose an arrangement you can open in the builder.
          </p>
          <div className="example-prompts">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="example-prompt" onClick={() => send(example)}>
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat-log">
          {transcript.map((entry, i) => (
            <div key={i} className={`chat-message chat-${entry.role}`}>
              <div className="chat-bubble">{entry.text}</div>
              {entry.proposals?.map((proposal, j) => (
                <ProposalCard key={j} proposal={proposal} onOpen={() => onOpenProposal(proposal)} />
              ))}
            </div>
          ))}
          {pending && (
            <div className="chat-message chat-assistant">
              <div className="chat-bubble muted">Designing your arrangement…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form className="chat-input" onSubmit={handleSubmit}>
        <textarea
          rows={2}
          value={input}
          placeholder="e.g. A rustic sunflower centerpiece under $40 cost"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
        />
        <button type="submit" className="btn-primary" disabled={pending || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

function ProposalCard({ proposal, onOpen }) {
  return (
    <div className="proposal">
      <div className="proposal-header">
        <strong>{proposal.name}</strong>
        <span className="muted">{proposal.total_stems} stems</span>
      </div>
      <ul className="proposal-items">
        {proposal.items.map((item) => (
          <li key={item.flower_name}>
            <span>
              {item.stems} × {item.flower_name}
            </span>
            <span className="muted">{formatCurrency(item.line_total)}</span>
          </li>
        ))}
      </ul>
      <div className="proposal-totals">
        <span>Cost {formatCurrency(proposal.total_cost)}</span>
        <span>Sells for {formatCurrency(proposal.selling_price)}</span>
        <span className="profit-positive">Profit {formatCurrency(proposal.profit)}</span>
      </div>
      <button type="button" className="btn-primary" onClick={onOpen}>
        Open in builder
      </button>
    </div>
  );
}
