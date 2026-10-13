import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";

const short = (t) => t.replace(/^IFC/, "Ifc").replace(/STANDARDCASE$/, "StandardCase");

/** Spatial tree: storey → IFC class → object, with visibility toggles per storey and per class. */
export default function ModelTree({ elements, selectedGids, onSelect, hidden, setHidden }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});
  const tree = useMemo(() => {
    const t = new Map();
    (elements || []).forEach((e) => {
      if (q && !`${e.name} ${e.ifc_type} ${e.global_id}`.toLowerCase().includes(q.toLowerCase())) return;
      if (!t.has(e.storey)) t.set(e.storey, new Map());
      const s = t.get(e.storey);
      if (!s.has(e.ifc_type)) s.set(e.ifc_type, []);
      s.get(e.ifc_type).push(e);
    });
    return t;
  }, [elements, q]);
  const toggle = (kind, key) => setHidden((h) => { const n = new Set(h[kind]); n.has(key) ? n.delete(key) : n.add(key); return { ...h, [kind]: n }; });
  const types = useMemo(() => [...new Set((elements || []).map((e) => e.ifc_type))].sort(), [elements]);

  return (
    <div className="flex h-full flex-col" data-testid="model-tree">
      <div className="border-b p-2"><Input data-testid="model-tree-search" placeholder="Rechercher un objet, une classe, un GlobalId…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 text-xs" /></div>
      <div className="flex-1 overflow-y-auto p-1 text-xs scroll-thin">
        <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Étages</div>
        {[...tree.entries()].map(([storey, byType]) => (
          <div key={storey}>
            <div className="flex items-center gap-1 rounded px-1 py-1 hover:bg-slate-50">
              <button onClick={() => setOpen((o) => ({ ...o, [storey]: !o[storey] }))} data-testid={`tree-storey-toggle-${storey}`}><ChevronRight className={`h-3.5 w-3.5 transition-transform ${open[storey] ? "rotate-90" : ""}`} /></button>
              <input type="checkbox" data-testid={`tree-storey-visible-${storey}`} checked={!hidden.storeys.has(storey)} onChange={() => toggle("storeys", storey)} />
              <span className="flex-1 font-semibold text-slate-800">{storey}</span>
              <span className="font-mono text-slate-400">{[...byType.values()].reduce((a, l) => a + l.length, 0)}</span>
            </div>
            {open[storey] && [...byType.entries()].map(([type, list]) => (
              <div key={type} className="ml-5">
                <button onClick={() => setOpen((o) => ({ ...o, [storey + type]: !o[storey + type] }))} className="flex w-full items-center gap-1 px-1 py-0.5 text-left text-slate-600 hover:bg-slate-50">
                  <ChevronRight className={`h-3 w-3 transition-transform ${open[storey + type] ? "rotate-90" : ""}`} />{short(type)}<span className="ml-auto font-mono text-slate-400">{list.length}</span>
                </button>
                {open[storey + type] && list.map((e) => (
                  <button key={e.global_id} data-testid={`tree-element-${e.global_id}`} onClick={(ev) => onSelect(e.global_id, ev.ctrlKey || ev.metaKey || ev.shiftKey)}
                    className={`ml-4 block w-[calc(100%-1rem)] truncate rounded px-1.5 py-0.5 text-left ${selectedGids?.has(e.global_id) ? "bg-amber-100 text-amber-900" : "text-slate-700 hover:bg-slate-50"}`}>{e.name || e.global_id}</button>
                ))}
              </div>
            ))}
          </div>
        ))}
        <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Catégories IFC</div>
        {types.map((t) => (
          <label key={t} className="flex items-center gap-2 px-2 py-0.5 text-slate-700">
            <input type="checkbox" data-testid={`tree-type-visible-${t}`} checked={!hidden.types.has(t)} onChange={() => toggle("types", t)} />{short(t)}
          </label>
        ))}
      </div>
    </div>
  );
}
