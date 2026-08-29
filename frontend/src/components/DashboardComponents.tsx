"use client";


import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchAPI,
  Station,
  AnomalyDetail,
  ProcessEvent,
} from "@/lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle,
  Activity,
  Zap,
  Thermometer,
  Clock,
  Shield,
  Eye,
  ChevronRight,
  Radio,
} from "lucide-react";
import { usePersona } from "@/lib/PersonaContext";

// ─────────────────────── Line Overview ───────────────────────

function StationCard({ station, selected, onClick }: { station: Station; selected?: boolean; onClick?: () => void }) {
  const cardRef = React.useRef<HTMLButtonElement>(null);
  const statusColors: Record<string, string> = {
    normal: "bg-green-500",
    warning: "bg-amber-500",
    anomaly: "bg-red-500",
  };
  const statusPulse: Record<string, string> = {
    normal: "",
    warning: "pulse-warning",
    anomaly: "pulse-anomaly",
  };
  const st = station.status || "normal";
  const { persona } = usePersona();

  // Auto-scroll selected station card into view
  useEffect(() => {
    if (selected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
  }, [selected]);

  return (
    <button
      ref={cardRef}
      id={`station-card-${station.id}`}
      onClick={onClick}
      className={`relative flex flex-col items-center p-3 rounded-lg border transition-all min-w-[90px] ${
        st === "anomaly"
          ? "border-red-500/50 bg-red-500/5"
          : st === "warning"
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-gray-800 bg-gray-900/50"
      } ${!station.has_sensors && persona === "supervisor" ? "ring-1 ring-purple-500/30" : ""} ${selected ? "ring-2 ring-cyan-400 bg-gray-800" : ""}`}
    >
      <div className={`w-3 h-3 rounded-full ${statusColors[st]} ${statusPulse[st]}`} />
      <span className="text-[10px] text-gray-400 mt-1.5 font-mono">
        S{station.sequence_no.toString().padStart(2, "0")}
      </span>
      <span className="text-[9px] text-gray-500 mt-0.5 text-center leading-tight max-w-[80px] truncate">
        {station.name.split(" - ")[1] || station.name}
      </span>
      {!station.has_sensors && (
        <span className={`absolute -top-2 -right-2 text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm ${
          persona === "supervisor" 
            ? "bg-purple-500 text-white" 
            : "bg-purple-500/20 text-purple-400"
        }`}>
          INF
        </span>
      )}
    </button>
  );
}

function ZoneGroup({ title, stations, selectedId, onSelect }: { title: string; stations: Station[]; selectedId?: string; onSelect?: (id: string) => void }) {
  if (stations.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest pl-2">
        {title}
      </h4>
      <div className="flex items-center bg-gray-900/30 p-2 rounded-xl border border-gray-800/50">
        {stations.map((s, i) => (
          <div key={s.id} className="flex items-center">
            <StationCard station={s} selected={s.id === selectedId} onClick={() => onSelect && onSelect(s.id)} />
            {i < stations.length - 1 && (
              <ChevronRight className="w-3 h-3 text-gray-700 mx-1 shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LineOverview({ stations, selectedId, onSelect }: { stations: Station[]; selectedId?: string; onSelect?: (id: string) => void }) {
  const anomalyCount = stations.filter((s) => s.status === "anomaly").length;
  
  const bodyStations = stations.filter(s => s.sequence_no >= 1 && s.sequence_no <= 10);
  const paintStations = stations.filter(s => s.sequence_no >= 11 && s.sequence_no <= 18);
  const assemblyStations = stations.filter(s => s.sequence_no >= 19 && s.sequence_no <= 30);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Activity className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-white">Assembly Line Overview (30 Stations)</h2>
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-[11px] font-mono text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.15)]">
            [Use ← / → Arrow Keys to Navigate Stations]
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Anomaly ({anomalyCount})
          </span>
          <span className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20 text-[10px] font-bold tracking-wider">
            INF = Legacy / Sensorless
          </span>
        </div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
        <ZoneGroup title="Body Construction" stations={bodyStations} selectedId={selectedId} onSelect={onSelect} />
        {paintStations.length > 0 && <ChevronRight className="w-5 h-5 text-gray-600 mt-10 shrink-0" />}
        <ZoneGroup title="Paint" stations={paintStations} selectedId={selectedId} onSelect={onSelect} />
        {assemblyStations.length > 0 && <ChevronRight className="w-5 h-5 text-gray-600 mt-10 shrink-0" />}
        <ZoneGroup title="Final Assembly" stations={assemblyStations} selectedId={selectedId} onSelect={onSelect} />
      </div>
    </section>
  );
}

// ─────────────────────── Residual Card ───────────────────────

function ResidualMetric({
  icon: Icon,
  label,
  actual,
  expected,
  residual,
  unit,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  actual: number;
  expected: number;
  residual: number;
  unit: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-900/50 border border-gray-800">
      <Icon className={`w-5 h-5 ${color} shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-lg font-bold text-white">{actual.toFixed(1)}</span>
          <span className="text-xs text-gray-500">vs {expected.toFixed(0)}{unit}</span>
        </div>
      </div>
      <div
        className={`px-2 py-1 rounded text-sm font-mono font-bold ${
          residual > 0 ? "bg-red-500/15 text-red-400" : "bg-green-500/15 text-green-400"
        }`}
      >
        {residual > 0 ? "+" : ""}
        {residual.toFixed(1)}
        {unit}
      </div>
    </div>
  );
}

function RootCauseBar({ causes }: { causes: { cause_label: string; probability_pct: number }[] }) {
  const colors: Record<string, string> = {
    tool_wear: "#f59e0b",
    motor_degradation: "#3b82f6",
    thermal_drift: "#ef4444",
  };
  const labels: Record<string, string> = {
    tool_wear: "Tool Wear",
    motor_degradation: "Motor Degradation",
    thermal_drift: "Thermal Drift",
  };

  return (
    <div className="mt-4">
      <p className="text-xs text-gray-400 mb-2 font-medium">Root Cause Analysis</p>
      <div className="flex h-6 rounded-md overflow-hidden">
        {causes.map((c) => (
          <div
            key={c.cause_label}
            style={{
              width: `${c.probability_pct}%`,
              backgroundColor: colors[c.cause_label] || "#6b7280",
            }}
            className="flex items-center justify-center text-[10px] font-bold text-white transition-all"
          >
            {c.probability_pct >= 15 && `${c.probability_pct.toFixed(0)}%`}
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-2">
        {causes.map((c) => (
          <span key={c.cause_label} className="flex items-center gap-1 text-[10px] text-gray-400">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: colors[c.cause_label] || "#6b7280" }}
            />
            {labels[c.cause_label] || c.cause_label} ({c.probability_pct.toFixed(0)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

function ConfidenceBadge({
  score,
  riskPct,
}: {
  score: number | null;
  riskPct: number | null;
}) {
  const s = score ?? 0;
  const color = s >= 80 ? "text-green-400 border-green-500/30" : s >= 60 ? "text-amber-400 border-amber-500/30" : "text-red-400 border-red-500/30";
  const bgColor = s >= 80 ? "bg-green-500/10" : s >= 60 ? "bg-amber-500/10" : "bg-red-500/10";

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${bgColor} ${color.split(" ")[1]}`}>
      <Shield className={`w-5 h-5 ${color.split(" ")[0]}`} />
      <div className="flex-1">
        <p className="text-xs text-gray-400">Confidence / Risk</p>
        <div className="flex items-baseline gap-3 mt-0.5">
          <span className={`text-xl font-bold ${color.split(" ")[0]}`}>{s.toFixed(0)}%</span>
          {riskPct != null && (
            <span className="text-sm text-red-400 font-medium">{riskPct.toFixed(0)}% risk</span>
          )}
        </div>
        {s < 60 && (
          <p className="text-[10px] text-red-400 mt-1">⚠ Low confidence — Physical inspection required</p>
        )}
      </div>
    </div>
  );
}

function ResidualCard({ anomaly, highlight }: { anomaly: AnomalyDetail; highlight?: boolean }) {
  return (
    <div className={`p-5 rounded-xl border bg-[#0a0f1a] transition-all ${highlight ? "border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/50" : "border-gray-800"}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">{anomaly.station.name}</h3>
            <p className="text-[10px] text-gray-500">
              Anomaly #{anomaly.id} • {anomaly.status.toUpperCase()}
            </p>
          </div>
        </div>
        <span className="text-xs px-2 py-1 rounded bg-red-500/15 text-red-400 font-medium">
          {anomaly.recommended_action?.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <ResidualMetric
          icon={Clock}
          label="Cycle Time"
          actual={(anomaly.residuals.cycle_time_sec ?? 0) + 52}
          expected={52}
          residual={anomaly.residuals.cycle_time_sec ?? 0}
          unit="s"
          color="text-cyan-400"
        />
        <ResidualMetric
          icon={Zap}
          label="Vibration"
          actual={(anomaly.residuals.vibration_mm_s ?? 0) + 2.8}
          expected={2.8}
          residual={anomaly.residuals.vibration_mm_s ?? 0}
          unit="mm/s"
          color="text-amber-400"
        />
        <ResidualMetric
          icon={Thermometer}
          label="Temperature"
          actual={(anomaly.residuals.temperature_c ?? 0) + 58}
          expected={58}
          residual={anomaly.residuals.temperature_c ?? 0}
          unit="°C"
          color="text-red-400"
        />
      </div>

      <ConfidenceBadge score={anomaly.confidence_score} riskPct={anomaly.predicted_risk_pct} />
      <RootCauseBar causes={anomaly.root_causes} />
    </div>
  );
}

// ─────────────────────── Residual Chart ───────────────────────

function ResidualChart({ events, baseline }: { events: ProcessEvent[]; baseline: number }) {
  const sorted = [...events].sort(
    (a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime()
  );
  const data = sorted.map((e, i) => ({
    idx: i + 1,
    vehicle: e.vehicle_id.replace("VEH_", "#"),
    actual: e.cycle_time_sec ?? 0,
    expected: baseline,
    residual: (e.cycle_time_sec ?? 0) - baseline,
  }));

  return (
    <div className="p-5 rounded-xl border border-gray-800 bg-[#0a0f1a]">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">
          Station 14 — Cycle Time Residuals
        </h3>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="vehicle" tick={{ fontSize: 10, fill: "#6b7280" }} />
          <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px", fontSize: 12 }}
            labelStyle={{ color: "#9ca3af" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={baseline} stroke="#22c55e" strokeDasharray="6 3" label={{ value: "Baseline", fill: "#22c55e", fontSize: 10 }} />
          <ReferenceLine y={baseline + 5} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
          <Line type="monotone" dataKey="actual" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3, fill: "#06b6d4" }} name="Actual" />
          <Line type="monotone" dataKey="expected" stroke="#22c55e" strokeWidth={1} strokeDasharray="6 3" dot={false} name="Expected" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────── Blast Radius ───────────────────────

function BlastRadiusPanel({
  vehicles,
  windowStart,
  windowEnd,
  highlight,
}: {
  vehicles: string[];
  windowStart: string;
  windowEnd: string | null;
  highlight?: boolean;
}) {
  const target = "VEH_4821";

  return (
    <div className={`p-5 rounded-xl border bg-[#0a0f1a] transition-all ${highlight ? "border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/50" : "border-gray-800"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-red-400" />
          <h3 className="text-sm font-semibold text-white">Blast Radius</h3>
        </div>
        <span className="text-xs text-red-400 font-medium">{vehicles.length} vehicles affected</span>
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        Window: {new Date(windowStart).toLocaleTimeString()} →{" "}
        {windowEnd ? new Date(windowEnd).toLocaleTimeString() : "ongoing"}
      </p>
      <div className="flex flex-wrap gap-2">
        {vehicles.map((v) => (
          <a
            key={v}
            href={`/vehicles/${v}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
              v === target
                ? "bg-red-500/20 text-red-300 border border-red-500/40 ring-2 ring-red-500/20"
                : "bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600"
            }`}
          >
            {v.replace("VEH_", "#")}
            {v === target && <span className="ml-1 text-[9px] text-red-400">← target</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────── What-If Modal ───────────────────────

function WhatIfPanel({
  scenarios,
  anomalyId,
  onApprove,
  highlight,
}: {
  scenarios: AnomalyDetail["what_if"];
  anomalyId: number;
  onApprove: () => void;
  highlight?: boolean;
}) {
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  const colorMap: Record<string, { border: string; bg: string; text: string }> = {
    continue: { border: "border-red-500/40", bg: "bg-red-500/5", text: "text-red-400" },
    slow_station: { border: "border-amber-500/40", bg: "bg-amber-500/5", text: "text-amber-400" },
    inspect_recalibrate: { border: "border-green-500/40", bg: "bg-green-500/5", text: "text-green-400" },
    Reroute: { border: "border-gray-700", bg: "bg-gray-900/50", text: "text-gray-300" },
    "Slow Line Speed": { border: "border-amber-500/40", bg: "bg-amber-500/5", text: "text-amber-400" },
    "Emergency E-Stop": { border: "border-purple-500/50", bg: "bg-purple-900/10", text: "text-purple-300" },
  };
  const labelMap: Record<string, string> = {
    continue: "Continue Production",
    slow_station: "Slow Station",
    inspect_recalibrate: "Inspect & Recalibrate",
    Reroute: "Scenario A: Reroute",
    "Slow Line Speed": "Scenario B: Slow Line Speed",
    "Emergency E-Stop": "Scenario C: Emergency E-Stop",
  };

  async function handleApprove() {
    setApproving(true);
    try {
      await fetchAPI(`/anomalies/${anomalyId}/approve`, { method: "POST", body: JSON.stringify({}) });
      setApproved(true);
      onApprove();
    } catch (e) {
      console.error(e);
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className={`p-5 rounded-xl border bg-[#0a0f1a] transition-all ${highlight ? "border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.15)] ring-1 ring-purple-500/50" : "border-gray-800"}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-white">What-If Decision Simulator</h3>
        </div>
        {highlight && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold uppercase tracking-wider">
            Plant Manager Tool
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {scenarios.map((s) => {
          const c = colorMap[s.scenario_label] || colorMap.continue;
          return (
            <div
              key={s.scenario_label}
              className={`relative p-4 rounded-lg border ${c.border} ${c.bg} transition-all`}
            >
              {s.is_recommended && (
                <span className="absolute -top-2 left-3 text-[9px] px-2 py-0.5 rounded-full bg-green-500 text-white font-bold uppercase tracking-wider">
                  Recommended
                </span>
              )}
              <p className={`text-xs font-semibold ${c.text} mb-3`}>
                {labelMap[s.scenario_label] || s.scenario_label}
              </p>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-gray-500">Throughput Impact</p>
                  <p className="text-lg font-bold text-white">
                    {s.projected_throughput_impact === 0
                      ? "0"
                      : s.projected_throughput_impact.toFixed(0)}{" "}
                    <span className="text-xs text-gray-400">veh/hr</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500">Defect Containment</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${s.projected_defect_containment}%`,
                          backgroundColor:
                            s.projected_defect_containment >= 90
                              ? "#22c55e"
                              : s.projected_defect_containment >= 50
                              ? "#f59e0b"
                              : "#ef4444",
                        }}
                      />
                    </div>
                    <span className="text-xs font-bold text-white">
                      {s.projected_defect_containment.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleApprove}
        disabled={approving || approved}
        className={`mt-4 w-full py-2.5 rounded-lg text-sm font-semibold transition-all ${
          approved
            ? "bg-green-500/20 text-green-400 cursor-default"
            : highlight 
              ? "bg-purple-600 hover:bg-purple-500 text-white cursor-pointer"
              : "bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer"
        }`}
      >
        {approved ? (
          <span className="flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4" /> Intervention Approved
          </span>
        ) : approving ? (
          "Approving..."
        ) : (
          "Approve Targeted Intervention"
        )}
      </button>
    </div>
  );
}


export const MemoLineOverview = React.memo(LineOverview);
export const MemoResidualCard = React.memo(ResidualCard);
export const MemoResidualChart = React.memo(ResidualChart);
export const MemoBlastRadiusPanel = React.memo(BlastRadiusPanel);
export const MemoWhatIfPanel = React.memo(WhatIfPanel);
