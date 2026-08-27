"use client";

import React, { useState, useEffect } from "react";
import { useStream } from "@/context/StreamContext";
import { MemoLineOverview } from "@/components/DashboardComponents";
import { AlertTriangle, Activity, CheckCircle, Zap, ShieldAlert, Thermometer, ShieldCheck, Clock } from "lucide-react";
import { fetchAPI, AnomalyDetail, ProcessEvent } from "@/lib/api";

export default function CommandCenterPage() {
  const { stations, kpis, vehicles, anomalies, loading, error, forceRefresh } = useStream();
  const [selectedStationId, setSelectedStationId] = useState<string>("STATION_14");

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

  // Find anomaly corresponding to the selected station
  const anomaly = anomalies.find(a => a.station?.id === selectedStation?.id);
  const blastRadiusVehicles = anomaly?.blast_radius || [];

  return (
    <div className="p-6 max-w-[1800px] mx-auto flex flex-col gap-6">
      {/* Header & Global KPIs */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Factory Command Center</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time synchronized digital twin • {stations.length} stations</p>
        </div>
        <div className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="px-3 border-r border-gray-800">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Line Velocity</p>
            <p className="text-lg font-mono text-white flex items-center gap-2">
              {kpis?.active_line_velocity.toFixed(1)} <span className="text-xs text-gray-500 font-sans">veh/hr</span>
            </p>
          </div>
          <div className="px-3 border-r border-gray-800">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Defect Risk</p>
            <p className="text-lg font-mono text-amber-400 flex items-center gap-2">
              {kpis?.fleet_defect_risk_pct.toFixed(0)}% <Activity className="w-4 h-4" />
            </p>
          </div>
          <div className="px-3 border-r border-gray-800">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Blind Inferred</p>
            <p className="text-lg font-mono text-cyan-400">
              {kpis?.blind_stations_inferred} <span className="text-xs text-gray-500 font-sans">/ {kpis?.total_blind_stations}</span>
            </p>
          </div>
          <div className="px-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Units in Buffer</p>
            <p className="text-lg font-mono text-white">{kpis?.total_units_in_buffer}</p>
          </div>
        </div>
      </div>

      {/* Top Pipeline */}
      <div className="bg-[#0a0f1a] rounded-xl border border-gray-800 p-5 shadow-lg relative z-10">
        <MemoLineOverview stations={stations} selectedId={selectedStationId} onSelect={setSelectedStationId} />
      </div>

      {/* Unified Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: Deep Dive (40%) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-5 shadow-lg flex-1">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-cyan-400" /> 
                  Station {selectedStation?.sequence_no}: {selectedStation?.name}
                </h2>
                <p className="text-xs text-gray-500 mt-1">Real-Time Deep Dive & Telemetry</p>
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
                  <p className="text-xs text-gray-400 mt-1">No causal anomaly detected.</p>
                </div>
              )}
              <div className="mt-4 pt-3 border-t border-gray-800 text-[10px] text-gray-500">
                <span className="text-gray-400 font-semibold">Sensor Density:</span> {hasSensors ? "100%" : "54% (Adjacent Interpolation)"}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Blast Radius & What-If (60%) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Top Panel: Digital Thread & Blast Radius */}
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-5 shadow-lg flex-col flex">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <ShieldAlert className="w-5 h-5 text-amber-500" /> Active Vehicle Digital Thread
            </h2>

            {/* Carousel */}
            <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {vehicles.map(v => {
                const isCritical = v.id === "VEH_4821";
                const isBlast = blastRadiusVehicles.includes(v.id) || v.is_in_blast_radius;
                
                return (
                  <div key={v.id} className={`shrink-0 w-32 rounded-lg border p-3 flex flex-col items-center justify-center transition-all ${
                    isCritical 
                      ? "border-red-500 bg-red-500/10 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse" 
                      : isBlast 
                      ? "border-amber-500/50 bg-amber-500/5" 
                      : "border-gray-800 bg-gray-900"
                  }`}>
                    <span className={`text-[10px] font-bold mb-1 ${isCritical ? 'text-red-400' : isBlast ? 'text-amber-400' : 'text-green-500'}`}>
                      {isCritical ? "CRITICAL ALERT" : isBlast ? "WARNING" : "PASSING"}
                    </span>
                    <span className="text-sm font-mono font-bold text-white">{v.id.replace("VEH_", "#")}</span>
                    <span className="text-[9px] text-gray-500 mt-1">{v.current_station}</span>
                  </div>
                )
              })}
            </div>

            {/* Exposed Blast Radius List */}
            {blastRadiusVehicles.length > 0 && (
              <div className="mt-2 bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-amber-500 uppercase tracking-widest">Exposed Blast Radius Containment ({blastRadiusVehicles.length} Units)</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {blastRadiusVehicles.map(vid => (
                    <div key={vid} className="px-3 py-1.5 bg-gray-900 border border-amber-500/30 rounded flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                      <span className="text-xs font-mono text-amber-100">{vid.replace("VEH_", "#")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Panel: What-If Simulator */}
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-5 shadow-lg flex-1 flex flex-col">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-purple-400" /> What-If Decision Simulator
            </h2>
            {anomaly ? (
              <>
                <div className="grid grid-cols-3 gap-4 flex-1">
                  {/* Scenario A */}
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col">
                    <h3 className="text-sm font-bold text-white mb-1">Scenario A: Continue</h3>
                    <p className="text-[10px] text-gray-500 mb-4 h-8">Projects downstream defect escape to end-of-line.</p>
                    <div className="space-y-3 mt-auto">
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase">Line Rate Impact</p>
                        <p className="text-base font-mono text-white">60 <span className="text-xs text-gray-400">veh/hr (±0)</span></p>
                      </div>
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase mb-1">Defect Containment</p>
                        <div className="w-full h-1.5 bg-gray-800 rounded-full"><div className="h-full bg-red-500 w-[10%]"></div></div>
                        <p className="text-xs text-red-400 mt-1">10% (High Risk)</p>
                      </div>
                    </div>
                  </div>

                  {/* Scenario B */}
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col">
                    <h3 className="text-sm font-bold text-white mb-1">Scenario B: Slow Station</h3>
                    <p className="text-[10px] text-gray-500 mb-4 h-8">Projects buffer delay vs throughput penalty.</p>
                    <div className="space-y-3 mt-auto">
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase">Line Rate Impact</p>
                        <p className="text-base font-mono text-amber-400">52 <span className="text-xs text-gray-400">veh/hr (-8)</span></p>
                      </div>
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase mb-1">Defect Containment</p>
                        <div className="w-full h-1.5 bg-gray-800 rounded-full"><div className="h-full bg-amber-500 w-[45%]"></div></div>
                        <p className="text-xs text-amber-400 mt-1">45% (Moderate Risk)</p>
                      </div>
                    </div>
                  </div>

                  {/* Scenario C */}
                  <div className="bg-purple-900/10 border-2 border-purple-500/50 rounded-lg p-4 flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 right-0 bg-purple-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-bl">RECOMMENDED</div>
                    <h3 className="text-sm font-bold text-white mb-1">Scenario C: Inspect & Recalibrate</h3>
                    <p className="text-[10px] text-purple-300/70 mb-4 h-8">Contains defect. 9 vehicles affected.</p>
                    <div className="space-y-3 mt-auto">
                      <div>
                        <p className="text-[9px] text-purple-400/70 uppercase">Line Rate Impact</p>
                        <p className="text-base font-mono text-purple-400">39 <span className="text-xs text-purple-400/50">veh/hr (-21)</span></p>
                      </div>
                      <div>
                        <p className="text-[9px] text-purple-400/70 uppercase mb-1">Defect Containment</p>
                        <div className="w-full h-1.5 bg-gray-900 rounded-full"><div className="h-full bg-green-500 w-[100%] shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div></div>
                        <p className="text-xs text-green-400 mt-1 font-bold">100% (Contained)</p>
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={async () => {
                    try {
                      await fetchAPI(`/anomalies/${anomaly.id}/approve`, {
                        method: 'POST',
                        body: JSON.stringify({ action: 'inspect recalibrate' })
                      });
                      forceRefresh();
                    } catch (err) {
                      console.error("Failed to approve intervention:", err);
                      alert("Error approving intervention. Check console for details.");
                    }
                  }}
                  className="mt-6 w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all flex justify-center items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" /> Approve Targeted Intervention
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-gray-500 p-8 border border-dashed border-gray-800 rounded-xl">
                <CheckCircle className="w-8 h-8 text-gray-700 mb-2" />
                <p>Select an active anomaly on the pipeline to run What-If scenarios.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
