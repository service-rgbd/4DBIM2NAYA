import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Eye, Focus, Loader2, Maximize, Scissors, ScanSearch } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { IfcEngine } from "@/lib/ifcEngine";

const Tool = ({ onClick, title, active, children, testid }) => (
  <button data-testid={testid} title={title} onClick={onClick} className={`grid h-8 w-8 place-items-center rounded-md border transition-colors ${active ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-slate-800/90 text-slate-200 hover:bg-slate-700"}`}>{children}</button>
);

function useIdMaps(elements) {
  return useMemo(() => {
    const e2g = new Map(), g2e = new Map(), g2el = new Map();
    (elements || []).forEach((el) => { e2g.set(el.express_id, el.global_id); g2e.set(el.global_id, el.express_id); g2el.set(el.global_id, el); });
    return { e2g, g2e, g2el };
  }, [elements]);
}

/** Creates the engine, downloads the IFC with the session cookie and builds the geometry. */
function useIfcEngine(versionId, box, mapsRef, pickRef) {
  const engine = useRef(null);
  const [state, setState] = useState({ status: "idle", progress: 0, error: "" });
  useEffect(() => {
    if (!versionId || !box.current) return undefined;
    const eng = new IfcEngine(box.current);
    engine.current = eng;
    eng.onPick = (eid, additive) => pickRef.current?.(eid == null ? null : mapsRef.current.e2g.get(eid) || null, additive);
    let cancelled = false;
    setState({ status: "download", progress: 0, error: "" });
    api.get(`/model-versions/${versionId}/file`, { responseType: "arraybuffer", onDownloadProgress: (p) => p.total && setState((s) => ({ ...s, progress: Math.round((p.loaded / p.total) * 100) })) })
      .then((r) => { if (cancelled) return null; setState({ status: "parse", progress: 0, error: "" }); return eng.load(r.data); })
      .then((res) => { if (!cancelled && res) setState({ status: "ready", progress: 100, error: "", meshes: res.meshCount }); })
      .catch((e) => !cancelled && setState({ status: "error", progress: 0, error: e?.response ? errMsg(e) : `Erreur de chargement 3D : ${e.message}` }));
    return () => { cancelled = true; eng.dispose(); engine.current = null; };
  }, [versionId, box, mapsRef, pickRef]);
  return [engine, state];
}

/** Pushes colours, selection and visibility filters into the engine whenever they change. */
function useEngineSync(engine, ready, maps, { colorMap, selectedGids, isVisible, isolated }) {
  useEffect(() => {
    const eng = engine.current;
    if (!eng || !ready) return;
    eng.known = new Set(maps.e2g.keys());
    eng.overrides = new Map();
    if (colorMap) colorMap.forEach((v, gid) => { const e = maps.g2e.get(gid); if (e != null) eng.overrides.set(e, v); });
    eng.selected = new Set([...(selectedGids || [])].map((g) => maps.g2e.get(g)).filter((v) => v != null));
    eng.filter = isVisible ? (eid) => { const g = maps.e2g.get(eid); return !g || isVisible(maps.g2el.get(g)); } : null;
    if (!isolated) eng.isolated = null;
    eng.refresh();
  }, [engine, colorMap, selectedGids, isVisible, maps, ready, isolated]);
}

/** Real IFC geometry viewer (web-ifc + Three.js). Business identity = IFC GlobalId; expressID only maps meshes. */
export default function IfcViewer({ versionId, elements, colorMap, selectedGids, onPick, isVisible, focusRequest, className = "" }) {
  const box = useRef(null);
  const [section, setSection] = useState({ on: false, ratio: 0.6 });
  const [isolated, setIsolated] = useState(false);
  const maps = useIdMaps(elements);
  const mapsRef = useRef(maps);
  mapsRef.current = maps;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [engine, state] = useIfcEngine(versionId, box, mapsRef, pickRef);
  const ready = state.status === "ready";
  useEngineSync(engine, ready, maps, { colorMap, selectedGids, isVisible, isolated });

  useEffect(() => {
    if (engine.current && ready && focusRequest?.gids?.length) engine.current.fit(focusRequest.gids.map((g) => mapsRef.current.g2e.get(g)).filter((v) => v != null));
  }, [engine, focusRequest, ready]);

  useEffect(() => { engine.current?.setSection(section.on, section.ratio); }, [engine, section, ready]);

  const isolate = () => {
    const eng = engine.current;
    if (!eng || !eng.selected.size) return;
    eng.isolated = new Set(eng.selected);
    setIsolated(true);
    eng.refresh();
  };
  const fitSel = () => engine.current?.fit([...engine.current.selected]);
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : box.current?.parentElement?.requestFullscreen?.());

  return (
    <div className={`relative overflow-hidden bg-slate-900 ${className}`} data-testid="ifc-viewer">
      <div ref={box} className="viewer-canvas absolute inset-0" />
      {!versionId && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400" data-testid="viewer-no-model">Aucune maquette traitée disponible. Le planning reste utilisable sans modèle 3D.</div>}
      {["download", "parse"].includes(state.status) && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/80 text-sm text-slate-200" data-testid="viewer-loading">
          <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{state.status === "download" ? `Téléchargement sécurisé du fichier IFC… ${state.progress} %` : "Génération de la géométrie (web-ifc)…"}</div>
        </div>
      )}
      {state.status === "error" && <div className="absolute inset-x-4 top-4 rounded-md border border-red-400 bg-red-950/90 p-3 text-sm text-red-100" data-testid="viewer-error">{state.error}</div>}
      {ready && (
        <>
          <div className="absolute left-3 top-3 flex flex-col gap-1.5">
            <Tool testid="viewer-fit-btn" title="Cadrage global" onClick={() => engine.current?.fit()}><ScanSearch className="h-4 w-4" /></Tool>
            <Tool testid="viewer-fit-selection-btn" title="Cadrer la sélection" onClick={fitSel}><Crosshair className="h-4 w-4" /></Tool>
            <Tool testid="viewer-isolate-btn" title="Isoler la sélection" active={isolated} onClick={isolate}><Focus className="h-4 w-4" /></Tool>
            <Tool testid="viewer-show-all-btn" title="Tout afficher" onClick={() => setIsolated(false)}><Eye className="h-4 w-4" /></Tool>
            <Tool testid="viewer-section-btn" title="Coupe horizontale" active={section.on} onClick={() => setSection((s) => ({ ...s, on: !s.on }))}><Scissors className="h-4 w-4" /></Tool>
            <Tool testid="viewer-fullscreen-btn" title="Plein écran" onClick={fullscreen}><Maximize className="h-4 w-4" /></Tool>
          </div>
          {section.on && (
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-slate-800/90 px-3 py-2 text-xs text-slate-200">
              Hauteur de coupe
              <input data-testid="viewer-section-slider" type="range" min={0} max={1} step={0.01} value={section.ratio} onChange={(e) => setSection({ on: true, ratio: Number(e.target.value) })} />
            </div>
          )}
          <div className="absolute bottom-3 right-3 rounded bg-slate-800/80 px-2 py-1 font-mono text-[10px] text-slate-400" data-testid="viewer-stats">{elements?.length || 0} objets · {state.meshes} avec géométrie · Ctrl/Maj+clic : multi-sélection</div>
        </>
      )}
    </div>
  );
}
