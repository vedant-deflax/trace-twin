"use client";

import React from "react";
import Link from "next/link";
import { useStream } from "@/context/StreamContext";
import { MemoWhatIfPanel } from "@/components/DashboardComponents";

export default function WhatIfPage() {
  const { anomalies, loading, forceRefresh } = useStream();

  if (loading) return <div className="p-6 text-white">Loading Simulator...</div>;

  const openAnomalies = anomalies.filter(a => a.status === 'open');

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">What-If Decision Simulator</h1>
        <p className="text-xs text-gray-500 mt-0.5">Project queueing math and containment strategies for active anomalies</p>
      </div>

      {openAnomalies.length === 0 ? (
        <div className="text-gray-400">No active anomalies requiring decisions.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {openAnomalies.map(anomaly => (
            <Link 
              key={anomaly.id} 
              href={`/?station=${anomaly.station.id}`}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-cyan-500 hover:shadow-[0_0_15px_rgba(6,182,212,0.2)] cursor-pointer transition-all flex flex-col block"
            >
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-white font-bold text-lg">Anomaly #{anomaly.id}</h2>
                <span className="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-1 rounded">ACTION REQUIRED</span>
              </div>
              <p className="text-sm text-gray-300 font-mono mb-1">{anomaly.station.name}</p>
              <p className="text-xs text-gray-500 mb-6">Confidence: {anomaly.confidence_score ? anomaly.confidence_score.toFixed(0) : '--'}% | Primary Root Cause: {anomaly.root_causes?.[0]?.cause_label?.replace(/_/g, " ")}</p>
              
              <div className="mt-auto text-sm text-cyan-400 flex justify-between items-center font-semibold">
                Run What-If Scenarios
                <span className="text-lg">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
