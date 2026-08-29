"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useStream } from "@/context/StreamContext";
import { usePersona } from "@/lib/PersonaContext";
import { MemoLineOverview } from "@/components/DashboardComponents";
import { 
  AlertTriangle, Activity, CheckCircle, Zap, ShieldAlert, 
  Thermometer, ShieldCheck, Clock, BarChart3, Gauge, Target, 
  DollarSign, TrendingUp, Award, ChevronRight 
} from "lucide-react";
import { fetchAPI, AnomalyDetail, ProcessEvent } from "@/lib/api";

export default function CommandCenterPage() {
  const { stations, kpis, vehicles, anomalies, loading, error, forceRefresh } = useStream();
  const { persona, setPersona } = usePersona();
  const [selectedStationId, setSelectedStationId] = useState<string>("STATION_14");
  const [selectedScenario, setSelectedScenario] = useState<string>("Emergency E-Stop");
  const [actionExecuting, setActionExecuting] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const station = params.get('station');
      if (station) {
        setSelectedStationId(station);
      }
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <Activity className="w-8 h-8 text-cyan-500 mb-4 animate-bounce" />
          <p className="text-sm text-cyan-400">Synchronizing Digital Twin...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-6 rounded-xl border border-red-500/30 bg-red-500/5 max-w-md">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-400 mb-1">Failed to connect to TRACE-TWIN API</p>
          <p className="text-xs text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  const selectedStation = stations.find(s => s.id === selectedStationId) || stations[0];
  const hasSensors = selectedStation?.has_sensors !== false; // boolean in api.ts

  // Real-time metrics from SSE stream
  const cycleTime = (selectedStation as any)?.cycle_time || 0;
  const vibration = (selectedStation as any)?.vibration || 0;
  const temp = (selectedStation as any)?.temperature || 0;
  const torque = (selectedStation as any)?.torque || 0;
  
  const baseline = selectedStation?.baseline;
  const ctDiff = baseline ? (cycleTime - baseline.expected_cycle_time_sec) : 0;
  const vibDiff = baseline ? (vibration - baseline.expected_vibration_mm_s) : 0;
  const tempDiff = baseline ? (temp - baseline.expected_temperature_c) : 0;

  // Active anomaly resolution: check if selected station has an open anomaly,
  // or fall back to any active open anomaly on the line
  const activeStationAnomaly = anomalies.find(
    a => a.status === 'open' && (a.station?.id === selectedStation?.id || (a as any).station_id === selectedStation?.id)
  );
  const openLineAnomaly = anomalies.find(a => a.status === 'open');
  const anomaly = activeStationAnomaly || openLineAnomaly || null;
  const blastRadiusVehicles = anomaly?.blast_radius || [];

  return (
    <div className="p-6 max-w-[1800px] mx-auto flex flex-col gap-6">
      {/* Header & Global KPIs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white tracking-tight">Factory Command Center</h1>
            
            {/* Persona Switcher Buttons */}
            <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-800 shadow-inner">
              <button
                onClick={() => setPersona("supervisor")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                  persona === "supervisor"
                    ? "bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.45)] ring-1 ring-cyan-400"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Activity className="w-3.5 h-3.5" /> Floor Supervisor
              </button>
              <button
                onClick={() => setPersona("manager")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                  persona === "manager"
                    ? "bg-purple-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.45)] ring-1 ring-purple-400"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" /> Plant Manager
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {persona === "supervisor"
              ? "Operational Floor View • Real-time telemetry, 3-sigma tolerance deviations, and immediate containment"
              : "Executive Management View • Macro OEE efficiency, capacity projections, and financial scrap impact"}
          </p>
        </div>

        {/* Dynamic KPI Header based on Persona */}
        {persona === "supervisor" ? (
          <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg p-2.5 shadow-md">
            <div className="px-3 border-r border-gray-800">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">Line Velocity</p>
              <p className="text-base font-mono text-white flex items-center gap-1.5">
                {kpis?.active_line_velocity.toFixed(1)} <span className="text-xs text-gray-500 font-sans">veh/hr</span>
              </p>
            </div>
            <div className="px-3 border-r border-gray-800">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">Active Anomalies</p>
              <p className="text-base font-mono text-red-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {stations.filter(s => s.status === "anomaly").length} <span className="text-xs text-gray-500 font-sans">stations</span>
              </p>
            </div>
            <div className="px-3 border-r border-gray-800">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">Defect Risk</p>
              <p className="text-base font-mono text-amber-400 flex items-center gap-1.5">
                {kpis?.fleet_defect_risk_pct.toFixed(0)}% <Activity className="w-3.5 h-3.5" />
              </p>
            </div>
            <div className="px-3 border-r border-gray-800">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">Buffer Fill</p>
              <p className="text-base font-mono text-white">{kpis?.total_units_in_buffer} <span className="text-xs text-gray-500 font-sans">units</span></p>
            </div>
            <div className="px-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">Blind Inferred</p>
              <p className="text-base font-mono text-cyan-400">
                {kpis?.blind_stations_inferred} <span className="text-xs text-gray-500 font-sans">/ {kpis?.total_blind_stations}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-gray-900 border border-purple-500/30 rounded-lg p-2.5 shadow-md shadow-purple-950/20">
            <div className="px-3 border-r border-gray-800">
              <p className="text-[10px] text-purple-400 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                <Gauge className="w-3 h-3 text-purple-400" /> Shift OEE
              </p>
              <p className="text-base font-mono text-emerald-400 font-bold flex items-center gap-1.5">
                86.4% <span className="text-[10px] px-1.5 py-0.2 bg-emerald-500/20 text-emerald-400 rounded">Target 85%</span>
              </p>
            </div>
            <div className="px-3 border-r border-gray-800">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                <Target className="w-3 h-3 text-cyan-400" /> Shift Output
              </p>
              <p className="text-base font-mono text-white font-bold flex items-center gap-1.5">
                412 <span className="text-xs text-gray-500 font-sans">/ 480 (85.8%)</span>
              </p>
            </div>
            <div className="px-3 border-r border-gray-800">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-emerald-400" /> Containment Savings
              </p>
              <p className="text-base font-mono text-emerald-400 font-bold">
                +$14,200 <span className="text-xs text-gray-500 font-sans font-normal">Scrap Avoided</span>
              </p>
            </div>
            <div className="px-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-amber-400" /> Fleet Risk Index
              </p>
              <p className="text-base font-mono text-amber-400 font-bold">
                {kpis?.fleet_defect_risk_pct.toFixed(0)}% <span className="text-xs text-gray-500 font-sans font-normal">Active Exposure</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Top Pipeline */}
      <div className="bg-[#0a0f1a] rounded-xl border border-gray-800 p-5 shadow-lg relative z-10">
        <MemoLineOverview stations={stations} selectedId={selectedStationId} onSelect={setSelectedStationId} />
      </div>

      {/* Unified Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: Deep Dive / Macro Health (40%) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {persona === "supervisor" ? (
            <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-5 shadow-lg flex-1 transition-all duration-300">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Activity className="w-5 h-5 text-cyan-400" /> 
                    Station {selectedStation?.sequence_no}: {selectedStation?.name}
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">Real-Time Deep Dive & Telemetry Scrubber</p>
                </div>
                {!hasSensors && (
                  <span className="px-2.5 py-1 bg-purple-500/20 border border-purple-500/30 text-purple-400 text-[10px] font-bold rounded">
                    SENSORLESS INFERRED
                  </span>
                )}
              </div>

              {/* Gauges Grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 relative overflow-hidden">
                  <div className={`absolute top-0 right-0 w-12 h-12 bg-gradient-to-br ${ctDiff > 10 ? 'from-red-500/20' : ctDiff > 5 ? 'from-amber-500/20' : 'from-cyan-500/20'} to-transparent rounded-bl-full blur-xl`}></div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Clock className="w-3 h-3"/> Cycle Time</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-mono text-white">{cycleTime.toFixed(1)}s</span>
                    <span className={`text-sm font-mono mb-1 ${ctDiff > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {ctDiff > 0 ? '+' : ''}{ctDiff.toFixed(1)}s
                    </span>
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 relative overflow-hidden">
                  <div className={`absolute top-0 right-0 w-12 h-12 bg-gradient-to-br ${vibDiff > 1 ? 'from-red-500/20' : 'from-cyan-500/20'} to-transparent rounded-bl-full blur-xl`}></div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Activity className="w-3 h-3"/> Vibration</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-mono text-white">{vibration.toFixed(1)}</span>
                    <span className={`text-sm font-mono mb-1 ${vibDiff > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                      {vibDiff > 0 ? '+' : ''}{vibDiff.toFixed(1)}
                    </span>
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 relative overflow-hidden">
                  <div className={`absolute top-0 right-0 w-12 h-12 bg-gradient-to-br ${tempDiff > 5 ? 'from-red-500/20' : 'from-cyan-500/20'} to-transparent rounded-bl-full blur-xl`}></div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Thermometer className="w-3 h-3"/> Temperature</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-mono text-white">{temp.toFixed(1)}°C</span>
                    <span className={`text-sm font-mono mb-1 ${tempDiff > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {tempDiff > 0 ? '+' : ''}{tempDiff.toFixed(1)}
                    </span>
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 relative overflow-hidden">
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Zap className="w-3 h-3"/> Torque (Inferred)</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-mono text-white">{torque.toFixed(1)}</span>
                    <span className="text-sm font-mono mb-1 text-gray-400">Nm</span>
                  </div>
                </div>
              </div>

              {/* Root Cause / Confidence */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500"></div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white">Probabilistic Root Cause</h3>
                  {anomaly && anomaly.confidence_score && (
                    <span className="text-[10px] px-2 py-1 bg-cyan-500/10 text-cyan-400 rounded-full font-mono flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> {anomaly.confidence_score.toFixed(0)}% Model Confidence
                    </span>
                  )}
                </div>
                
                {anomaly && anomaly.root_causes ? (
                  <div className="space-y-4">
                    {anomaly.root_causes.map((cause, idx) => {
                      const isPrimary = idx === 0;
                      return (
                        <div key={cause.cause_label}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className={`${isPrimary ? "text-white" : "text-gray-400"} font-medium flex items-center gap-1.5`}>
                              <span className={`w-2 h-2 rounded-full ${isPrimary ? "bg-cyan-500" : "bg-gray-600"}`}></span> {cause.cause_label.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                            </span>
                            <span className={`${isPrimary ? "text-cyan-400" : "text-gray-400"} font-mono`}>{cause.probability_pct.toFixed(1)}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className={`h-full ${isPrimary ? "bg-cyan-500" : "bg-gray-600"}`} style={{ width: `${cause.probability_pct}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-gray-800/50 border border-green-500/20 rounded p-4 text-center mt-2">
                    <CheckCircle className="w-6 h-6 text-green-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-green-400">Nominal 3-Sigma Operation</p>
                    <p className="text-xs text-gray-400 mt-1">No causal anomaly detected on selected station.</p>
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-gray-800 text-[10px] text-gray-500">
                  <span className="text-gray-400 font-semibold">Sensor Density:</span> {hasSensors ? "100%" : "54% (Adjacent Interpolation)"}
                </div>
              </div>
            </div>
          ) : (
            /* Plant Manager: Macro Plant Health & OEE Panel */
            <div className="bg-[#0a0f1a] border border-purple-500/30 rounded-xl p-5 shadow-lg flex-1 transition-all duration-300">
              <div className="flex items-center justify-between mb-5 border-b border-gray-800 pb-3">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-purple-400" /> Macro Plant Health & OEE
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">Shift 1 Comprehensive Operational Effectiveness • 8-Hour Assembly Window</p>
                </div>
                <span className="px-2.5 py-1 bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[10px] font-bold tracking-wider rounded flex items-center gap-1">
                  <Award className="w-3 h-3" /> EXECUTIVE OEE
                </span>
              </div>

              {/* Shift OEE Gauge & Breakdown */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4 relative overflow-hidden">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Overall Equipment Effectiveness (OEE)</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-4xl font-mono font-bold text-emerald-400">86.4%</span>
                      <span className="text-xs text-emerald-300/80 font-medium bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        +1.4% vs 85.0% World-Class Target
                      </span>
                    </div>
                  </div>
                  <div className="w-14 h-14 rounded-full border-4 border-emerald-500/80 bg-emerald-500/10 flex items-center justify-center font-mono font-bold text-white text-xs shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                    86.4%
                  </div>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-gray-800">
                  {/* Availability */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-cyan-400" /> Availability (Runtime Efficiency)
                      </span>
                      <span className="font-mono text-cyan-400 font-bold">91.0% <span className="text-gray-500 font-normal">(43.2m downtime)</span></span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-400 rounded-full" style={{ width: "91%" }} />
                    </div>
                  </div>

                  {/* Performance */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 flex items-center gap-1.5">
                        <Gauge className="w-3 h-3 text-purple-400" /> Performance (Operating Speed)
                      </span>
                      <span className="font-mono text-purple-400 font-bold">96.0% <span className="text-gray-500 font-normal">({kpis?.active_line_velocity.toFixed(1)} / 52.0 veh/hr)</span></span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-400 rounded-full" style={{ width: "96%" }} />
                    </div>
                  </div>

                  {/* Quality */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 flex items-center gap-1.5">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" /> Quality (First-Pass Yield)
                      </span>
                      <span className="font-mono text-emerald-400 font-bold">98.8% <span className="text-gray-500 font-normal">(Defect-Free FPY)</span></span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 rounded-full" style={{ width: "98.8%" }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Shift Output vs Target & Financial Scrap Impact */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Projected Shift Output */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5 flex flex-col justify-between">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                      <Target className="w-3 h-3 text-cyan-400" /> Projected Shift Output
                    </p>
                    <div className="flex items-baseline gap-1.5 mt-1.5">
                      <span className="text-2xl font-mono font-bold text-white">412</span>
                      <span className="text-xs text-gray-400 font-mono">/ 480 Chassis</span>
                    </div>
                    <p className="text-[11px] text-amber-400 mt-1">Projected: 476 (-4 vs Target)</p>
                  </div>
                  <div className="mt-3">
                    <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden relative">
                      <div className="h-full bg-cyan-500 rounded-full" style={{ width: "85.8%" }} />
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1 text-right">85.8% of Shift Completed</p>
                  </div>
                </div>

                {/* Financial Scrap / Loss Prevention */}
                <div className="bg-gray-900 border border-emerald-500/20 rounded-xl p-3.5 flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-bl-full blur-lg pointer-events-none" />
                  <div>
                    <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-emerald-400" /> Financial Impact Avoided
                    </p>
                    <div className="flex items-baseline gap-1.5 mt-1.5">
                      <span className="text-2xl font-mono font-bold text-emerald-400">+$14,200</span>
                    </div>
                    <p className="text-[11px] text-gray-300 mt-1">Scrap & Teardown Loss Prevented</p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-800 text-[10px] text-gray-400 flex justify-between">
                    <span>8 Quarantined Units</span>
                    <span className="font-mono text-emerald-400">~$1,775 / unit saved</span>
                  </div>
                </div>
              </div>

              {/* Top 3 Historical Bottleneck Stations */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-amber-400" /> Top 3 Line Constraints & Bottlenecks
                  </h3>
                  <span className="text-[10px] text-gray-500">Cumulative Shift Drift</span>
                </div>

                <div className="space-y-2">
                  {/* Bottleneck 1 */}
                  <div
                    onClick={() => setSelectedStationId("STATION_14")}
                    className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                      selectedStationId === "STATION_14"
                        ? "bg-red-950/30 border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                        : "bg-gray-950/60 border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded bg-red-500/20 text-red-400 text-xs font-bold font-mono flex items-center justify-center border border-red-500/30">
                        1
                      </span>
                      <div>
                        <p className="text-xs font-bold text-white">Station 14: Framing - Torque & Weld R14</p>
                        <p className="text-[10px] text-gray-400">Primary Constraint • Fastener Spindle Degradation</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono font-bold text-red-400">38.4h Drift</p>
                      <span className="text-[9px] text-red-300/80 bg-red-500/10 px-1.5 py-0.2 rounded font-mono">94% Risk</span>
                    </div>
                  </div>

                  {/* Bottleneck 2 */}
                  <div
                    onClick={() => setSelectedStationId("STATION_09")}
                    className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                      selectedStationId === "STATION_09"
                        ? "bg-purple-950/30 border-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.2)]"
                        : "bg-gray-950/60 border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded bg-purple-500/20 text-purple-400 text-xs font-bold font-mono flex items-center justify-center border border-purple-500/30">
                        2
                      </span>
                      <div>
                        <p className="text-xs font-bold text-white">Station 09: Paint - Clear Coat P9</p>
                        <p className="text-[10px] text-gray-400">Thermal Curing Variance • Exotherm Spike</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono font-bold text-purple-400">14.2h Drift</p>
                      <span className="text-[9px] text-purple-300/80 bg-purple-500/10 px-1.5 py-0.2 rounded font-mono">68% Risk</span>
                    </div>
                  </div>

                  {/* Bottleneck 3 */}
                  <div
                    onClick={() => setSelectedStationId("STATION_26")}
                    className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                      selectedStationId === "STATION_26"
                        ? "bg-amber-950/30 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
                        : "bg-gray-950/60 border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded bg-amber-500/20 text-amber-400 text-xs font-bold font-mono flex items-center justify-center border border-amber-500/30">
                        3
                      </span>
                      <div>
                        <p className="text-xs font-bold text-white">Station 26: Final Assembly - Fastener F26</p>
                        <p className="text-[10px] text-gray-400">Micro-Stoppages & Downstream Fitment Resistance</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono font-bold text-amber-400">9.8h Drift</p>
                      <span className="text-[9px] text-amber-300/80 bg-amber-500/10 px-1.5 py-0.2 rounded font-mono">52% Risk</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Blast Radius & What-If (60%) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Top Panel: Digital Thread & Blast Radius */}
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-5 shadow-lg flex-col flex">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <ShieldAlert className="w-5 h-5 text-amber-500" /> Active Vehicle Digital Thread
            </h2>

            {/* Carousel (Active in-flight vehicles on conveyor, max 30) */}
            <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {vehicles
                .filter(v => !v.completed)
                .slice(0, 30)
                .map(v => {
                  const isCritical = (v as any).status === 'critical';
                  const isBlast = (v as any).status === 'warning' || (v as any).is_in_blast_radius;

                  const badgeText = isCritical
                    ? (v as any).defect_label || "CRITICAL (Out-of-Spec - High Risk)"
                    : isBlast
                    ? (v as any).defect_label || "WARNING (At Risk - Blast Radius)"
                    : "PASSING (Normal 3-Sigma)";

                  return (
                    <Link
                      key={v.id}
                      href={`/vehicle-deep-dive?vehicleId=${v.id}`}
                      className="shrink-0 group"
                    >
                      <div className={`w-48 rounded-lg border p-3 flex flex-col items-center justify-center transition-all group-hover:scale-105 group-hover:border-cyan-400 cursor-pointer ${
                        isCritical 
                          ? "border-red-500 bg-red-500/10 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse" 
                          : isBlast 
                          ? "border-amber-500/50 bg-amber-500/10" 
                          : "border-gray-800 bg-gray-900/80"
                      }`}>
                        <span className={`text-[9px] font-bold mb-1.5 text-center leading-tight px-1.5 py-0.5 rounded ${
                          isCritical
                            ? "bg-red-500/20 text-red-400 border border-red-500/40"
                            : isBlast
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                            : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        }`}>
                          {badgeText}
                        </span>
                        <span className="text-sm font-mono font-bold text-white mt-1">{v.id.replace("VEH_", "#")}</span>
                        <span className="text-[10px] text-gray-400 mt-1 font-mono">{v.current_station || "In-Flight"}</span>
                      </div>
                    </Link>
                  );
                })}
            </div>

            {/* Exposed Blast Radius List */}
            {blastRadiusVehicles.length > 0 && (
              <div className="mt-2 bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-amber-500 uppercase tracking-widest flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" />
                    Exposed Blast Radius Containment ({blastRadiusVehicles.length} Units)
                  </h3>
                  <span className="text-[10px] text-gray-400 font-mono">
                    Target: {anomaly?.station?.name || selectedStation?.name}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {blastRadiusVehicles.map(vid => (
                    <Link
                      key={vid}
                      href={`/vehicle-deep-dive?vehicleId=${vid}`}
                      className="px-3 py-1.5 bg-gray-900 border border-amber-500/30 rounded flex items-center gap-2 hover:border-amber-400 hover:scale-105 transition-all"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                      <span className="text-xs font-mono text-amber-100">{vid.replace("VEH_", "#")}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Panel: What-If Simulator */}
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-5 shadow-lg flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-purple-400" /> What-If Decision Simulator
              </h2>
              {anomaly && (
                <span className="text-xs font-mono text-cyan-400 bg-cyan-950/40 px-2.5 py-1 rounded border border-cyan-800/40">
                  Target Station: {anomaly.station?.id || selectedStationId}
                </span>
              )}
            </div>

            {actionSuccessMessage && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" /> {actionSuccessMessage}
              </div>
            )}

            {anomaly ? (
              <>
                <div className="grid grid-cols-3 gap-4 flex-1">
                  {/* Scenario A: Reroute */}
                  <div
                    onClick={() => setSelectedScenario("Reroute")}
                    className={`rounded-lg p-4 flex flex-col cursor-pointer transition-all ${
                      selectedScenario === "Reroute"
                        ? "bg-cyan-950/30 border-2 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)]"
                        : "bg-gray-900 border border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-bold text-white">Scenario A: Reroute</h3>
                      {selectedScenario === "Reroute" && (
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 mb-4 h-8 leading-snug">Projects downstream buffer bypass to alternate cell.</p>
                    <div className="space-y-3 mt-auto">
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase">Line Rate Impact</p>
                        <p className="text-base font-mono text-white">54 <span className="text-xs text-gray-400">veh/hr (-6)</span></p>
                      </div>
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase mb-1">Defect Containment</p>
                        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-amber-500 w-[70%]"></div></div>
                        <p className="text-xs text-amber-400 mt-1">70% (Moderate Containment)</p>
                      </div>
                    </div>
                  </div>

                  {/* Scenario B: Slow Line Speed */}
                  <div
                    onClick={() => setSelectedScenario("Slow Line Speed")}
                    className={`rounded-lg p-4 flex flex-col cursor-pointer transition-all ${
                      selectedScenario === "Slow Line Speed"
                        ? "bg-amber-950/30 border-2 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)]"
                        : "bg-gray-900 border border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-bold text-white">Scenario B: Slow Line Speed</h3>
                      {selectedScenario === "Slow Line Speed" && (
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 mb-4 h-8 leading-snug">Projects line deceleration to reduce tooling stress and chatter.</p>
                    <div className="space-y-3 mt-auto">
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase">Line Rate Impact</p>
                        <p className="text-base font-mono text-amber-400">48 <span className="text-xs text-gray-400">veh/hr (-12)</span></p>
                      </div>
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase mb-1">Defect Containment</p>
                        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-amber-400 w-[85%]"></div></div>
                        <p className="text-xs text-amber-400 mt-1">85% (High Containment)</p>
                      </div>
                    </div>
                  </div>

                  {/* Scenario C: Emergency E-Stop (RECOMMENDED) */}
                  <div
                    onClick={() => setSelectedScenario("Emergency E-Stop")}
                    className={`rounded-lg p-4 flex flex-col relative overflow-hidden cursor-pointer transition-all ${
                      selectedScenario === "Emergency E-Stop"
                        ? "bg-purple-950/40 border-2 border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.35)]"
                        : "bg-purple-900/10 border-2 border-purple-500/50 hover:border-purple-400/80"
                    }`}
                  >
                    <div className="absolute top-0 right-0 bg-purple-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-bl">RECOMMENDED</div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-bold text-white">Scenario C: Emergency E-Stop</h3>
                      {selectedScenario === "Emergency E-Stop" && (
                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping"></span>
                      )}
                    </div>
                    <p className="text-[10px] text-purple-300/80 mb-4 h-8 leading-snug">Immediate line interlock & tool recalibration. Full containment.</p>
                    <div className="space-y-3 mt-auto">
                      <div>
                        <p className="text-[9px] text-purple-400/70 uppercase">Line Rate Impact</p>
                        <p className="text-base font-mono text-purple-400">32 <span className="text-xs text-purple-400/50">veh/hr (-28)</span></p>
                      </div>
                      <div>
                        <p className="text-[9px] text-purple-400/70 uppercase mb-1">Defect Containment</p>
                        <div className="w-full h-1.5 bg-gray-900 rounded-full overflow-hidden"><div className="h-full bg-green-500 w-[100%] shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div></div>
                        <p className="text-xs text-green-400 mt-1 font-bold">100% (Fully Contained)</p>
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  disabled={actionExecuting}
                  onClick={async () => {
                    const targetStationId = anomaly.station?.id || selectedStationId;
                    setActionExecuting(true);
                    setActionSuccessMessage(null);
                    try {
                      await fetchAPI('/actions/execute', {
                        method: 'POST',
                        body: JSON.stringify({
                          station_id: targetStationId,
                          scenario_label: selectedScenario,
                          anomaly_id: anomaly.id,
                        })
                      });
                      setActionSuccessMessage(`Intervention '${selectedScenario}' executed for ${targetStationId}. Telemetry reset to baseline (Δ=0).`);
                      setTimeout(() => setActionSuccessMessage(null), 5000);
                      forceRefresh();
                    } catch (err) {
                      console.error("Failed to execute intervention:", err);
                      alert("Error executing intervention. Check console for details.");
                    } finally {
                      setActionExecuting(false);
                    }
                  }}
                  className="mt-6 w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all flex justify-center items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {actionExecuting ? (
                    <>
                      <Activity className="w-4 h-4 animate-spin" /> Executing {selectedScenario}...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" /> Execute & Resolve: {selectedScenario}
                    </>
                  )}
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-gray-500 p-8 border border-dashed border-gray-800 rounded-xl">
                <CheckCircle className="w-8 h-8 text-green-500/60 mb-2" />
                <p className="text-sm text-gray-300 font-medium">All Stations Operating Within Nominal 3-Sigma Limits</p>
                <p className="text-xs text-gray-500 mt-1">No active anomalies requiring what-if resolution.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
