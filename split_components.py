import os

with open('frontend/src/app/page.tsx', 'r') as f:
    lines = f.readlines()

split_idx = 0
for i, line in enumerate(lines):
    if "MAIN PAGE" in line:
        split_idx = i
        break

imports_and_components = lines[:split_idx]
main_page = lines[split_idx:]

with open('frontend/src/components/DashboardComponents.tsx', 'w') as f:
    f.writelines(imports_and_components)
    # also export the components
    f.write("\nexport const MemoLineOverview = React.memo(LineOverview);\n")
    f.write("export const MemoResidualCard = React.memo(ResidualCard);\n")
    f.write("export const MemoResidualChart = React.memo(ResidualChart);\n")
    f.write("export const MemoBlastRadiusPanel = React.memo(BlastRadiusPanel);\n")
    f.write("export const MemoWhatIfPanel = React.memo(WhatIfPanel);\n")

with open('frontend/src/app/page.tsx', 'w') as f:
    f.write('"use client";\n\n')
    f.write('import React from "react";\n')
    f.write('import { useStream } from "@/context/StreamContext";\n')
    f.write('import { MemoLineOverview } from "@/components/DashboardComponents";\n')
    f.write('import { AlertTriangle } from "lucide-react";\n\n')
    
    # We will redefine DashboardPage directly
    f.write('''export default function DashboardPage() {
  const { stations, kpis, loading, error } = useStream();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading factory telemetry...</p>
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

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Assembly Line Overview</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time anomaly detection • {stations.length} stations
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 bg-gray-800/50 px-4 py-2 rounded-lg border border-gray-700/50">
            <div>
              <p className="text-[10px] text-gray-400">Line Velocity</p>
              <p className="text-sm font-mono text-white">{kpis?.active_line_velocity.toFixed(1)} veh/hr</p>
            </div>
            <div className="w-px h-6 bg-gray-700"></div>
            <div>
              <p className="text-[10px] text-gray-400">Defect Risk</p>
              <p className="text-sm font-mono text-amber-400">{kpis?.fleet_defect_risk_pct.toFixed(0)}%</p>
            </div>
            <div className="w-px h-6 bg-gray-700"></div>
            <div>
              <p className="text-[10px] text-gray-400">Blind Inferred</p>
              <p className="text-sm font-mono text-cyan-400">{kpis?.blind_stations_inferred}/{kpis?.total_blind_stations}</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            System Online
          </span>
        </div>
      </div>

      {/* Line Overview */}
      <MemoLineOverview stations={stations} />
    </div>
  );
}
''')

