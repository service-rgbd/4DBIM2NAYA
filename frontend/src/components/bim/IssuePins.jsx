import { useEffect, useRef, useState } from "react";
import { ISSUE_STATUS } from "@/lib/format";

export const PIN_COLORS = { critique: "#DC2626", haute: "#EA580C", normale: "#2563EB", basse: "#64748B" };
const PRIO_RANK = { critique: 0, haute: 1, normale: 2, basse: 3 };
const UNRESOLVED = ["ouvert", "affecte", "en_cours", "a_verifier"];

/** Groups unresolved issues of a model by IFC GlobalId; the pin takes the highest priority. */
export function buildIssuePins(items, modelId) {
  const byGid = new Map();
  (items || []).filter((i) => i.global_id && i.model_id === modelId && UNRESOLVED.includes(i.status)).forEach((i) => {
    if (!byGid.has(i.global_id)) byGid.set(i.global_id, []);
    byGid.get(i.global_id).push(i);
  });
  return [...byGid].map(([gid, issues]) => {
    issues.sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority]);
    return { gid, issues, priority: issues[0].priority };
  });
}

function PinList({ pin, onOpen }) {
  return (
    <div className="absolute left-1/2 top-full z-10 mt-1 w-64 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900/95 p-1 shadow-xl backdrop-blur" data-testid={`issue-pin-list-${pin.gid}`}>
      {pin.issues.map((i) => (
        <button key={i.id} data-testid={`issue-pin-item-${i.reference}`} onClick={() => onOpen(i.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-100 transition-colors hover:bg-slate-700">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PIN_COLORS[i.priority] }} />
          <span className="font-mono text-[10px] text-slate-400">{i.reference}</span>
          <span className="truncate">{i.title}</span>
          <span className="ml-auto shrink-0 text-[10px] text-slate-400">{ISSUE_STATUS[i.status]}</span>
        </button>
      ))}
    </div>
  );
}

/** HTML pins over the canvas; the engine moves them every frame. */
export default function IssuePins({ engine, ready, pins, g2e, onOpen }) {
  const nodes = useRef(new Map());
  const [openGid, setOpenGid] = useState(null);
  useEffect(() => {
    const eng = engine.current;
    if (!eng || !ready) return undefined;
    eng.setMarkers(pins.map((p) => ({ eid: g2e.get(p.gid), node: nodes.current.get(p.gid) })).filter((m) => m.eid != null && m.node));
    return () => eng.setMarkers([]);
  }, [engine, ready, pins, g2e]);
  const click = (p) => (p.issues.length === 1 ? onOpen(p.issues[0].id) : setOpenGid(openGid === p.gid ? null : p.gid));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="issue-pins-layer">
      {pins.map((p) => (
        <div key={p.gid} ref={(el) => (el ? nodes.current.set(p.gid, el) : nodes.current.delete(p.gid))} className="pointer-events-auto absolute left-0 top-0 flex flex-col items-center" style={{ display: "none" }}>
          <button data-testid={`issue-pin-${p.gid}`} data-priority={p.priority} title={p.issues.map((i) => `${i.reference} · ${i.title}`).join("\n")} onClick={() => click(p)}
            className="relative grid h-6 min-w-6 place-items-center rounded-full border-2 border-white px-1 text-[11px] font-bold text-white shadow-lg transition-transform hover:scale-125" style={{ background: PIN_COLORS[p.priority] }}>
            {p.priority === "critique" && <span className="absolute inset-0 -z-10 animate-ping rounded-full" style={{ background: PIN_COLORS.critique, opacity: 0.5 }} />}
            {p.issues.length}
          </button>
          <span className="h-2 w-0.5 bg-white/80" />
          {openGid === p.gid && <PinList pin={p} onOpen={(id) => { setOpenGid(null); onOpen(id); }} />}
        </div>
      ))}
    </div>
  );
}
