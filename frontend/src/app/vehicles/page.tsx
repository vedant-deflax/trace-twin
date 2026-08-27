"use client";

import React from "react";
import { useStream } from "@/context/StreamContext";
import { AlertTriangle, CheckCircle, ShieldAlert } from "lucide-react";

export default function VehiclesPage() {
  const { vehicles, loading, error } = useStream();

  if (loading) {
    return <div className="p-6 text-white">Loading Digital Thread...</div>;
  }
  if (error) {
    return <div className="p-6 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Digital Thread & Vehicle Inspector</h1>
        <p className="text-xs text-gray-500 mt-0.5">Active vehicles in the assembly pipeline</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {vehicles.map((v) => (
          <div key={v.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col relative overflow-hidden">
            {v.is_in_blast_radius && (
              <div className="absolute top-0 left-0 right-0 bg-red-600 text-white text-[9px] font-bold py-1 text-center animate-pulse">
                BLAST RADIUS CONTAINMENT REQUIRED
              </div>
            )}
            <div className={`mt-4 flex items-center justify-between mb-3`}>
              <span className="text-lg font-mono font-bold text-white">{v.id.replace("VEH_", "#")}</span>
              <span className={`px-2 py-1 rounded text-xs font-bold ${
                v.status === 'critical' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                v.status === 'warning' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                'bg-green-500/20 text-green-400 border border-green-500/30'
              }`}>
                {v.status.toUpperCase()}
              </span>
            </div>
            
            <div className="space-y-2 mt-auto">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="w-16">Location:</span>
                <span className="text-gray-200">{v.current_station || "Unknown"}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="w-16">Health:</span>
                {v.status === 'critical' ? (
                  <span className="text-red-400 flex items-center gap-1"><ShieldAlert className="w-3 h-3"/> Anomalous Exposure</span>
                ) : (
                  <span className="text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3"/> Passing</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
