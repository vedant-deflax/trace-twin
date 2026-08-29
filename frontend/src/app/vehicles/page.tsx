"use client";

import React from "react";
import Link from "next/link";
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
        {vehicles
          .filter(v => !v.completed)
          .slice(0, 30)
          .map((v) => {
            const isCritical = v.id === "VEH_4821" || v.status === "critical";
            const isBlast = [
              "VEH_4817", "VEH_4818", "VEH_4819", "VEH_4820",
              "VEH_4822", "VEH_4823", "VEH_4824", "VEH_4825"
            ].includes(v.id) || v.status === "warning" || v.is_in_blast_radius;

            const badgeText = isCritical
              ? "CRITICAL (Torque Out-of-Spec - 94% Defect Risk)"
              : isBlast
              ? "WARNING (At Risk - Blast Radius)"
              : "PASSING (Normal 3-Sigma)";

            return (
              <Link key={v.id} href={`/vehicle-deep-dive?vehicleId=${v.id}`} className="block">
                <div className={`bg-gray-900 border rounded-xl p-4 flex flex-col relative overflow-hidden hover:scale-[1.02] cursor-pointer transition duration-150 h-full ${
                  isCritical
                    ? "border-red-500 bg-red-500/5 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                    : isBlast
                    ? "border-amber-500/50 bg-amber-500/5"
                    : "border-gray-800 hover:border-cyan-400"
                }`}>
                  {isCritical && (
                    <div className="absolute top-0 left-0 right-0 bg-red-600 text-white text-[9px] font-bold py-1 text-center animate-pulse">
                      TORQUE CRITICAL — DEFECT ESCAPE RISK
                    </div>
                  )}
                  {isBlast && !isCritical && (
                    <div className="absolute top-0 left-0 right-0 bg-amber-600 text-white text-[9px] font-bold py-1 text-center">
                      BLAST RADIUS CONTAINMENT REQUIRED
                    </div>
                  )}
                <div className={`${isCritical || isBlast ? "mt-4" : ""} flex items-center justify-between mb-3`}>
                  <span className="text-lg font-mono font-bold text-white">{v.id.replace("VEH_", "#")}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    isCritical ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                    isBlast ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
                    'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {badgeText}
                  </span>
                </div>
                
                <div className="space-y-2 mt-auto">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="w-16">Location:</span>
                    <span className="text-gray-200 font-mono">{v.current_station || "Unknown"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="w-16">Health:</span>
                    {isCritical ? (
                      <span className="text-red-400 flex items-center gap-1 font-semibold"><ShieldAlert className="w-3.5 h-3.5"/> 94% Defect Probability</span>
                    ) : isBlast ? (
                      <span className="text-amber-400 flex items-center gap-1 font-semibold"><AlertTriangle className="w-3.5 h-3.5"/> At Risk (Blast Radius)</span>
                    ) : (
                      <span className="text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5"/> Passing (Normal 3-Sigma)</span>
                    )}
                  </div>
                </div>
              </div>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
