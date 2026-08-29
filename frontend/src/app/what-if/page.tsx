"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useStream } from "@/context/StreamContext";
import { fetchAPI } from "@/lib/api";
import { AlertTriangle, CheckCircle, ShieldAlert, Zap, ArrowRight, Activity } from "lucide-react";

export default function WhatIfPage() {
  const { anomalies, stations, loading, forceRefresh } = useStream();
  const [executingId, setExecutingId] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (loading) return <div className="p-6 text-white">Loading Simulator...</div>;

  const openAnomalies = anomalies.filter(a => a.status === 'open');

  const handleQuickResolve = async (e: React.MouseEvent, anomaly: any, scenario: string = "Emergency E-Stop") => {
    e.preventDefault();
    e.stopPropagation();
    setExecutingId(anomaly.id);
    setSuccessMsg(null);
    try {
      await fetchAPI('/actions/execute', {
        method: 'POST',
        body: JSON.stringify({
          station_id: anomaly.station.id,
          scenario_label: scenario,
          anomaly_id: anomaly.id,
        })
      });
      setSuccessMsg(`Intervention '${scenario}' executed for ${anomaly.station.name}. Telemetry reset to baseline.`);
      setTimeout(() => setSuccessMsg(null), 5000);
      forceRefresh();
    } catch (err) {
      console.error("Failed to execute quick intervention:", err);
      alert("Error executing intervention. Check console for details.");
    } finally {
      setExecutingId(null);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-400" /> What-If Decision Simulator
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time projection queueing math, root-cause diagnostics, and containment interventions
          </p>
        </div>
        <div className="text-xs text-gray-400 font-mono bg-gray-900 border border-gray-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${openAnomalies.length > 0 ? "bg-red-500 animate-pulse" : "bg-green-500"}`} />
          Active Anomalies: {openAnomalies.length}
        </div>
      </div>

      {successMsg && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle className="w-5 h-5 shrink-0" /> {successMsg}
        </div>
      )}

      {openAnomalies.length === 0 ? (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-12 text-center max-w-xl mx-auto">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">Line Operating at 100% Nominal Health</h3>
          <p className="text-xs text-gray-400 mb-6">All 30 stations are within 3-sigma limits. No active anomalies requiring containment.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
          >
            Return to Line Overview <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {openAnomalies.map(anomaly => {
            const blastCount = anomaly.blast_radius ? anomaly.blast_radius.length : 0;
            const isThisExecuting = executingId === anomaly.id;

            return (
              <div 
                key={anomaly.id} 
                className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-cyan-500/60 transition-all flex flex-col justify-between relative group shadow-lg"
              >
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                      <h2 className="text-white font-bold text-lg">Station {anomaly.station.sequence_no}: {anomaly.station.name}</h2>
                    </div>
                    <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded border border-red-500/30">
                      CRITICAL DRIFT
                    </span>
                  </div>

                  <p className="text-xs text-gray-400 mb-3">
                    Primary Root Cause: <span className="text-cyan-400 font-semibold">{anomaly.root_causes?.[0]?.cause_label || "Tool Wear Drift"}</span>
                  </p>

                  <div className="grid grid-cols-3 gap-2 bg-gray-950 p-3 rounded-lg border border-gray-800 mb-4 text-center font-mono">
                    <div>
                      <p className="text-[9px] text-gray-500 uppercase">CT Drift</p>
                      <p className="text-sm font-bold text-red-400">+{anomaly.residual_cycle_time?.toFixed(1) || 0}s</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-gray-500 uppercase">Vibration</p>
                      <p className="text-sm font-bold text-amber-400">+{anomaly.residual_vibration?.toFixed(2) || 0}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-gray-500 uppercase">Temp</p>
                      <p className="text-sm font-bold text-red-400">+{anomaly.residual_temperature?.toFixed(1) || 0}°C</p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span className="flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Correlated Blast Radius:</span>
                      <span className="font-mono text-amber-400 font-bold">{blastCount} Vehicles</span>
                    </div>
                    {blastCount > 0 && anomaly.blast_radius && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {anomaly.blast_radius.slice(0, 7).map((vid: string) => (
                          <span key={vid} className="text-[10px] font-mono bg-gray-800 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/20">
                            {vid.replace("VEH_", "#")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 pt-3 border-t border-gray-800">
                  <div className="flex gap-2">
                    <button
                      disabled={isThisExecuting}
                      onClick={(e) => handleQuickResolve(e, anomaly, "Emergency E-Stop")}
                      className="flex-1 py-2 px-3 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(168,85,247,0.3)] disabled:opacity-50 cursor-pointer"
                    >
                      {isThisExecuting ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      Execute E-Stop & Recalibrate
                    </button>
                    <Link
                      href={`/?station=${anomaly.station.id}`}
                      className="py-2 px-3 bg-gray-800 hover:bg-gray-700 text-cyan-400 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1"
                    >
                      Inspect <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
