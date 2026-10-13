import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, diffDays, parseD, monthLabel, isWorking, workingDaysBetween, HEALTH, fmtShort } from "@/lib/format";

const DW = { day: 30, week: 13, month: 4.5 };

function useRange(tasks, baseline, simDate) {
  return useMemo(() => {
    const starts = tasks.map((t) => t.early_start).filter(Boolean);
    const ends = tasks.map((t) => t.early_finish).filter(Boolean);
    if (baseline) baseline.forEach((b) => { if (b.finish) ends.push(b.finish); if (b.start) starts.push(b.start); });
    if (simDate) { starts.push(simDate); ends.push(simDate); }
    if (!starts.length) return null;
    let o = addDays(starts.sort()[0], -7);
    o = addDays(o, -((parseD(o).getUTCDay() + 6) % 7));
    const end = addDays(ends.sort().slice(-1)[0], 28);
    return { origin: o, days: diffDays(o, end) };
  }, [tasks, baseline, simDate]);
}

const Header = ({ origin, days, dw, zoom }) => {
  const months = [], subs = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(origin, i);
    const dt = parseD(d);
    if ((i === 0 && dt.getUTCDate() < 22) || dt.getUTCDate() === 1) months.push({ i, label: monthLabel(dt) });
    if (zoom === "day") subs.push({ i, label: dt.getUTCDate(), w: dw });
    else if (zoom === "week" && dt.getUTCDay() === 1) subs.push({ i, label: `S${fmtShort(d).slice(0, 5)}`, w: dw * 7 });
  }
  return (
    <div className="relative h-12 border-b border-slate-200 bg-slate-50" style={{ width: days * dw }}>
      {months.map((m) => <div key={m.i} className="absolute top-0 h-6 border-l border-slate-200 px-1.5 text-[11px] font-semibold capitalize leading-6 text-slate-600" style={{ left: m.i * dw }}>{m.label}</div>)}
      {subs.map((s) => <div key={s.i} className="absolute top-6 h-6 border-l border-slate-200 text-center font-mono text-[10px] leading-6 text-slate-500" style={{ left: s.i * dw, width: s.w }}>{s.label}</div>)}
    </div>
  );
};

const Bar = ({ t, x, w, row, rh, selected, critical, canEdit, onDown, drag }) => {
  const h = HEALTH[t.health] || HEALTH.a_realiser;
  const off = drag?.id === t.id ? drag.snap : 0;
  const left = x + (drag?.id === t.id && drag.mode === "move" ? off : 0);
  const width = Math.max(w + (drag?.id === t.id && drag.mode === "resize" ? off : 0), 6);
  if (t.is_milestone) {
    return <div data-testid={`gantt-milestone-${t.code}`} title={`${t.code} ${t.name}`} onPointerDown={(e) => canEdit && onDown(e, t, "move")}
      className={`absolute h-3.5 w-3.5 rotate-45 border-2 ${critical ? "border-red-600 bg-red-500" : "border-slate-800 bg-slate-700"} ${selected ? "ring-2 ring-blue-500" : ""}`}
      style={{ left: left - 7, top: row * rh + rh / 2 - 7, cursor: canEdit ? "grab" : "pointer" }} />;
  }
  return (
    <div data-testid={`gantt-bar-${t.code}`} title={`${t.code} ${t.name} — ${t.progress || 0} %`} onPointerDown={(e) => canEdit && onDown(e, t, "move")}
      className={`gantt-bar absolute overflow-hidden rounded-[4px] ${selected ? "ring-2 ring-blue-600 ring-offset-1" : ""} ${critical ? "outline outline-2 outline-red-600" : ""}`}
      style={{ left, width, top: row * rh + 7, height: rh - 16, background: h.hex + "55", cursor: canEdit ? "grab" : "pointer", borderLeft: `3px solid ${h.hex}` }}>
      <div className="h-full" style={{ width: `${t.progress || 0}%`, background: h.hex }} />
      {canEdit && <div data-testid={`gantt-resize-${t.code}`} onPointerDown={(e) => { e.stopPropagation(); onDown(e, t, "resize"); }} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/10" />}
    </div>
  );
};

function depPath(d, pos, dw) {
  const p = pos[d.predecessor_id], s = pos[d.successor_id];
  if (!p || !s) return null;
  const x1 = d.type === "SS" || d.type === "SF" ? p.x : p.x + p.w;
  const x2 = d.type === "FF" || d.type === "SF" ? s.x + s.w : s.x;
  const into = d.type === "FF" || d.type === "SF" ? 8 : -8;
  const mid = x1 + (d.type === "SS" || d.type === "SF" ? -10 : 10);
  return `M${x1},${p.y} H${mid} V${s.y} H${x2 + into * 0} `;
}

/** Pointer drag (move / resize) snapped to days; callbacks read through a ref so they are never stale. */
function useGanttDrag(dw, onSelect, onDragEnd, calendar) {
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const cb = useRef({});
  cb.current = { onSelect, onDragEnd, calendar };
  const dragId = drag?.id;

  useEffect(() => {
    if (!dragId) return undefined;
    const move = (e) => {
      const dx = e.clientX - dragRef.current.x0;
      const snap = Math.round(dx / dw) * dw;
      dragRef.current.snap = snap;
      if (Math.abs(dx) > 3) dragRef.current.moved = true;
      setDrag({ ...dragRef.current });
    };
    const up = () => {
      const st = dragRef.current;
      setDrag(null);
      const { onSelect: select, onDragEnd: end, calendar: cal } = cb.current;
      if (!st.moved) { select?.(st.task); return; }
      const nd = Math.round(st.snap / dw);
      if (!nd) return;
      const t = st.task;
      if (st.mode === "move") end?.(t, { start: addDays(t.early_start, nd) });
      else {
        const newEnd = addDays(t.early_finish, nd);
        end?.(t, { start: t.start, duration: Math.max(1, newEnd < t.early_start ? 1 : workingDaysBetween(t.early_start, newEnd, cal)) });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [dragId, dw]);

  const onDown = (e, t, mode) => {
    e.preventDefault();
    dragRef.current = { id: t.id, task: t, mode, x0: e.clientX, snap: 0, moved: false };
    setDrag({ ...dragRef.current });
  };
  return { drag, onDown };
}

const TaskTable = ({ tasks, compact, rh, selectedId, highlightIds, showCritical, onSelect }) => (
  <div className="sticky left-0 z-20 shrink-0 border-r border-slate-200 bg-white" style={{ width: compact ? 220 : 380 }}>
    <div className="sticky top-0 z-10 flex h-12 items-end border-b border-slate-200 bg-slate-50 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      <span className="w-14">Code</span><span className="flex-1">Activité</span>
      {!compact && <><span className="w-16">Début</span><span className="w-16">Fin</span><span className="w-9 text-right">Dur.</span></>}
    </div>
    {tasks.map((t) => (
      <div key={t.id} data-testid={`gantt-row-${t.code}`} onClick={() => onSelect?.(t)} style={{ height: rh }}
        className={`flex cursor-pointer items-center border-b border-slate-100 px-2 text-xs transition-colors ${selectedId === t.id ? "bg-blue-50" : highlightIds?.has(t.id) ? "bg-amber-50" : "hover:bg-slate-50"}`}>
        <span className={`w-14 font-mono text-[11px] ${showCritical && t.is_critical ? "font-bold text-red-700" : "text-slate-500"}`}>{t.code}</span>
        <span className="flex-1 truncate font-medium text-slate-800" title={t.name}>{t.name}</span>
        {!compact && <><span className="w-16 font-mono text-[11px] text-slate-600">{fmtShort(t.early_start)}</span><span className="w-16 font-mono text-[11px] text-slate-600">{fmtShort(t.early_finish)}</span><span className="w-9 text-right font-mono text-[11px] text-slate-600">{t.is_milestone ? "◆" : `${t.duration}j`}</span></>}
      </div>
    ))}
  </div>
);

function useScrollToDate(scroller, range, simDate, dw, compact) {
  useEffect(() => {
    if (!range || !simDate || !scroller.current) return;
    const x = diffDays(range.origin, simDate) * dw;
    const el = scroller.current;
    const left = compact ? 0 : 380;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - left - 40) el.scrollLeft = Math.max(0, x - (el.clientWidth - left) / 2);
  }, [scroller, simDate, range, dw, compact]);
}

export default function Gantt({ tasks, deps, zoom = "week", selectedId, highlightIds, onSelect, onDragEnd, canEdit, baseline, simDate, today, showCritical, rowHeight = 34, compact, calendar }) {
  const range = useRange(tasks, baseline, simDate);
  const scroller = useRef(null);
  const dw = DW[zoom];
  const rh = rowHeight;
  const { drag, onDown } = useGanttDrag(dw, onSelect, onDragEnd, calendar);
  useScrollToDate(scroller, range, simDate, dw, compact);

  if (!range) return <div className="p-6 text-sm text-slate-500">Aucune activité à afficher.</div>;
  const { origin, days } = range;
  const pos = {};
  tasks.forEach((t, i) => {
    const x = diffDays(origin, t.early_start) * dw;
    const w = t.is_milestone ? 0 : (diffDays(t.early_start, t.early_finish) + 1) * dw;
    pos[t.id] = { x, w, y: i * rh + rh / 2 };
  });
  const height = tasks.length * rh;
  const nonWorking = zoom !== "month" ? Array.from({ length: days }, (_, i) => addDays(origin, i)).map((d, i) => (!isWorking(d, calendar) ? i : null)).filter((v) => v !== null) : [];

  return (
    <div ref={scroller} className="relative h-full overflow-auto scroll-thin bg-white" data-testid="gantt-chart">
      <div className="flex" style={{ width: (compact ? 220 : 380) + days * dw }}>
        <TaskTable tasks={tasks} compact={compact} rh={rh} selectedId={selectedId} highlightIds={highlightIds} showCritical={showCritical} onSelect={onSelect} />
        <div className="relative" style={{ width: days * dw }}>
          <div className="sticky top-0 z-10"><Header origin={origin} days={days} dw={dw} zoom={zoom} /></div>
          <div className="relative" style={{ height }}>
            {nonWorking.map((i) => <div key={i} className="absolute top-0 bg-slate-100/70" style={{ left: i * dw, width: dw, height }} />)}
            {tasks.map((t, i) => <div key={t.id} className={`absolute left-0 w-full border-b border-slate-100 ${highlightIds?.has(t.id) ? "bg-amber-50/60" : ""}`} style={{ top: i * rh, height: rh }} />)}
            {baseline && tasks.map((t, i) => {
              const b = baseline.get(t.id);
              if (!b?.start) return null;
              return <div key={`b${t.id}`} data-testid={`gantt-baseline-${t.code}`} className="absolute rounded-sm bg-slate-400/70" style={{ left: diffDays(origin, b.start) * dw, width: Math.max((diffDays(b.start, b.finish) + 1) * dw, 3), top: i * rh + rh - 8, height: 4 }} />;
            })}
            <svg className="pointer-events-none absolute left-0 top-0" width={days * dw} height={height}>
              <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#64748b" /></marker></defs>
              {deps.map((d) => {
                const path = depPath(d, pos, dw);
                const crit = showCritical && tasks.find((t) => t.id === d.predecessor_id)?.is_critical && tasks.find((t) => t.id === d.successor_id)?.is_critical;
                return path && <path key={d.id} d={path} fill="none" stroke={crit ? "#dc2626" : "#94a3b8"} strokeWidth={crit ? 1.6 : 1.2} markerEnd="url(#arr)" />;
              })}
            </svg>
            {tasks.map((t, i) => <Bar key={t.id} t={t} x={pos[t.id].x} w={pos[t.id].w} row={i} rh={rh} selected={selectedId === t.id} critical={showCritical && t.is_critical} canEdit={canEdit} onDown={onDown} drag={drag} />)}
            {!canEdit && tasks.map((t, i) => <div key={`c${t.id}`} className="absolute cursor-pointer" style={{ left: pos[t.id].x - 6, width: pos[t.id].w + 12, top: i * rh, height: rh }} onClick={() => onSelect?.(t)} />)}
            {today && <div className="absolute top-0 border-l-2 border-dashed border-red-500" style={{ left: diffDays(origin, today) * dw + dw / 2, height }} title="Aujourd'hui" />}
            {simDate && <div data-testid="gantt-sim-line" className="absolute top-0 w-0.5 bg-blue-600" style={{ left: diffDays(origin, simDate) * dw + dw / 2, height }} />}
          </div>
        </div>
      </div>
    </div>
  );
}
