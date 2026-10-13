import { useEffect, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward, ChevronLeft, ChevronRight, CalendarCheck } from "lucide-react";
import { addDays, diffDays, fmtD } from "@/lib/format";
import { LEGENDS, PHASE_COLORS, PHASE_LABELS } from "@/lib/sim4d";

const STEP = { jour: 1, semaine: 7, mois: 30 };
const Btn = ({ onClick, children, testid, title }) => <button data-testid={testid} title={title} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-100">{children}</button>;

export default function Timeline({ start, end, date, setDate, playing, setPlaying, step, setStep, speed, setSpeed, mode, setMode, counts, today }) {
  const ref = useRef(date);
  ref.current = date;
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      const n = addDays(ref.current, STEP[step] * speed);
      if (n >= end) { setDate(end); setPlaying(false); } else setDate(n);
    }, 350);
    return () => clearInterval(id);
  }, [playing, step, speed, end, setDate, setPlaying]);
  const total = Math.max(diffDays(start, end), 1);
  const go = (n) => setDate(n < start ? start : n > end ? end : n);
  return (
    <div className="border-y border-slate-200 bg-white px-3 py-2" data-testid="timeline-bar">
      <div className="flex flex-wrap items-center gap-2">
        <Btn testid="timeline-start-btn" title="Début" onClick={() => go(start)}><SkipBack className="h-4 w-4" /></Btn>
        <Btn testid="timeline-prev-btn" title="Pas précédent" onClick={() => go(addDays(date, -STEP[step]))}><ChevronLeft className="h-4 w-4" /></Btn>
        <button data-testid="timeline-play-btn" onClick={() => { if (date >= end) setDate(start); setPlaying(!playing); }} className="grid h-8 w-10 place-items-center rounded-md bg-blue-700 text-white hover:bg-blue-800" title={playing ? "Pause" : "Lecture"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <Btn testid="timeline-next-btn" title="Pas suivant" onClick={() => go(addDays(date, STEP[step]))}><ChevronRight className="h-4 w-4" /></Btn>
        <Btn testid="timeline-end-btn" title="Fin" onClick={() => go(end)}><SkipForward className="h-4 w-4" /></Btn>
        <Btn testid="timeline-today-btn" title="Aujourd'hui" onClick={() => go(today)}><CalendarCheck className="h-4 w-4" /></Btn>
        <div className="min-w-[150px] rounded-md bg-slate-900 px-3 py-1 text-center font-mono text-sm font-bold text-white" data-testid="timeline-date">{fmtD(date)}</div>
        <select data-testid="timeline-step-select" value={step} onChange={(e) => setStep(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-xs">{Object.keys(STEP).map((s) => <option key={s} value={s}>Pas : {s}</option>)}</select>
        <select data-testid="timeline-speed-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-8 rounded-md border border-slate-200 px-2 text-xs">{[1, 2, 5].map((s) => <option key={s} value={s}>×{s}</option>)}</select>
        <div className="ml-auto flex overflow-hidden rounded-md border border-slate-200 text-xs font-semibold" data-testid="timeline-mode">
          {[["prevu", "Prévu"], ["reel", "Réel"], ["ecart", "Écart prévu/réel"]].map(([k, l]) => (
            <button key={k} data-testid={`timeline-mode-${k}`} onClick={() => setMode(k)} className={`px-3 py-1.5 ${mode === k ? "bg-blue-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-[10px] text-slate-500">{fmtD(start)}</span>
        <input data-testid="timeline-slider" type="range" min={0} max={total} value={diffDays(start, date)} onChange={(e) => go(addDays(start, Number(e.target.value)))} className="flex-1 accent-blue-700" />
        <span className="font-mono text-[10px] text-slate-500">{fmtD(end)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3" data-testid="phase-legend">
        {LEGENDS[mode].map((p) => (
          <span key={p} className="flex items-center gap-1.5 text-[11px] text-slate-600" data-testid={`legend-${p}`}>
            <span className="h-2.5 w-2.5 rounded-sm border border-slate-300" style={{ background: PHASE_COLORS[p] }} />{PHASE_LABELS[p]} <b className="font-mono">{counts[p] || 0}</b>
          </span>
        ))}
        {mode === "reel" && date > today && <span className="text-[11px] font-semibold text-amber-700">Au-delà d'aujourd'hui : état réel connu à ce jour (pas d'extrapolation)</span>}
      </div>
    </div>
  );
}
