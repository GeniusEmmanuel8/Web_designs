import { Check, CircleHelp, GitBranch, Scale, Trash2 } from "lucide-react";
import type { DecisionEdge, DecisionNode, RelationType } from "../types";

type InspectorProps = {
  node?: DecisionNode;
  edge?: DecisionEdge;
  siblingNodes: DecisionNode[];
  onUpdateNode: (nodeId: string, patch: Partial<DecisionNode["data"]>) => void;
  onSelectOption: (nodeId: string, optionId: string) => void;
  onChooseNode: (nodeId: string) => void;
  onUpdateEdge: (edgeId: string, relation: RelationType) => void;
  onDelete: () => void;
};

const relations: RelationType[] = ["flows_to", "requires", "conflicts", "supports", "unlocks", "affects"];

export function Inspector({ node, edge, siblingNodes, onUpdateNode, onSelectOption, onChooseNode, onUpdateEdge, onDelete }: InspectorProps) {
  if (!node && !edge) {
    return (
      <aside className="inspector-panel inspector-panel--empty">
        <CircleHelp size={22} />
        <strong>Nothing selected</strong>
        <p>Choose a node or connection to inspect the decision behind it.</p>
      </aside>
    );
  }

  if (edge) {
    const relation = edge.data?.relation ?? "supports";
    const pending = edge.data?.validationStatus === "pending";
    return (
      <aside className="inspector-panel">
        <header className="inspector-heading">
          <span className={`selection-icon selection-icon--${relation}`}><GitBranch size={17} /></span>
          <div><span>Connection</span><h3>{relation}</h3></div>
        </header>

        <label className="field">
          <span>Relationship</span>
          <select value={relation} onChange={(event) => onUpdateEdge(edge.id, event.target.value as RelationType)}>
            {relations.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>

        <section className={`relation-note relation-note--${relation}`}>
          <strong>{pending ? "Checking compatibility" : relation === "conflicts" ? "Conflict detected" : "Why this connection exists"}</strong>
          <p>{edge.data?.rationale ?? "This relationship was added by the user."}</p>
          {relation === "conflicts" && <small>The connection stays visible in yellow until resolved or explicitly overridden.</small>}
        </section>

        <p className="inspector-tip">Drag either end of the selected line to reconnect it.</p>
        <button className="danger-action" type="button" onClick={onDelete}><Trash2 size={16} /> Delete connection</button>
      </aside>
    );
  }

  if (!node) return null;

  return (
    <aside className="inspector-panel">
      <header className="inspector-heading">
        <span className="selection-icon">{node.data.label.slice(0, 1)}</span>
        <div><span>Decision node</span><h3>{node.data.title}</h3></div>
      </header>

      <section className="decision-explanation">
        <div>
          <span>What this decides</span>
          <p>{node.data.why ?? node.data.subtitle}</p>
        </div>
        <div>
          <span>How it works</span>
          <p>{node.data.subtitle}</p>
        </div>
        <div className="decision-explanation__tradeoff">
          <span>Why choose it</span>
          <p>{node.data.pro}</p>
        </div>
        <div className="decision-explanation__tradeoff decision-explanation__tradeoff--risk">
          <span>Watch for</span>
          <p>{node.data.con}</p>
        </div>
        <div>
          <span>Changes downstream</span>
          <p>{node.data.downstream ?? "This choice becomes part of the selected project path."}</p>
        </div>
      </section>

      {siblingNodes.length > 1 && (
        <section className="decision-compare">
          <div className="section-label"><Scale size={14} /> Compare this stage</div>
          <div className="decision-compare__list">
            {siblingNodes.map((candidate) => {
              const active = candidate.data.status === "chosen";
              return (
                <button className={active ? "is-active" : ""} type="button" key={candidate.id} onClick={() => onChooseNode(candidate.id)}>
                  <span><strong>{candidate.data.title}</strong>{active && <Check size={12} />}</span>
                  <small className="compare-pro">+ {candidate.data.pro}</small>
                  <small className="compare-con">- {candidate.data.con}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="decision-edit">
        <div className="section-label">Edit decision</div>
        <label className="field">
          <span>Stage name</span>
          <input value={node.data.groupTitle ?? ""} onChange={(event) => onUpdateNode(node.id, { groupTitle: event.target.value })} />
        </label>
        <label className="field">
          <span>Card title</span>
          <input value={node.data.title} onChange={(event) => onUpdateNode(node.id, { title: event.target.value, label: event.target.value })} />
        </label>

        <label className="field">
          <span>How it works</span>
          <textarea rows={3} value={node.data.subtitle} onChange={(event) => onUpdateNode(node.id, { subtitle: event.target.value, description: event.target.value })} />
        </label>

        <label className="field">
          <span>Why choose it</span>
          <input value={node.data.pro} onChange={(event) => onUpdateNode(node.id, { pro: event.target.value })} />
        </label>

        <label className="field">
          <span>Watch for</span>
          <input value={node.data.con} onChange={(event) => onUpdateNode(node.id, { con: event.target.value })} />
        </label>
      </section>

      {node.data.options.length > 0 && (
        <section className="option-section">
          <div className="section-label">Choose an approach</div>
          <div className="option-list">
            {node.data.options.map((option) => (
              <button
                className={`option-choice ${node.data.selectedOptionId === option.id ? "is-active" : ""}`}
                type="button"
                key={option.id}
                onClick={() => onSelectOption(node.id, option.id)}
              >
                <span className="option-radio" aria-hidden="true" />
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                {option.recommended && <em>Recommended</em>}
              </button>
            ))}
          </div>
        </section>
      )}

      <button className="danger-action" type="button" onClick={onDelete}><Trash2 size={16} /> Delete node</button>
    </aside>
  );
}
