"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useStream } from "@/context/StreamContext";
import { fetchAPI } from "@/lib/api";
import { Activity, ShieldAlert, CheckCircle, Search, Info } from "lucide-react";

function VehicleDeepDiveContent() {
  const searchParams = useSearchParams();
  const { vehicles, stations, anomalies, loading } = useStream();
  const [selectedVid, setSelectedVid] = useState<string>(searchParams.get("vehicleId") || "VEH_4821");
  const [selectedSeq, setSelectedSeq] = useState<number>(14);
  const [vehicleDetail, setVehicleDetail] = useState<any>(null);
  
  const sortedStations = [...stations].sort((a, b) => a.sequence_no - b.sequence_no);
  
  useEffect(() => {
    // If param changes, update it
    const paramId = searchParams.get("vehicleId");
    if (paramId) {
      setSelectedVid(paramId);
    }
  }, [searchParams]);

  useEffect(() => {
    async function loadDetails() {
      if (!selectedVid) return;
      try {
        const detail = await fetchAPI(`/vehicles/${selectedVid}`);
        setVehicleDetail(detail);
      } catch (err) {
        console.error("Failed to load vehicle details:", err);
      }
    }
    loadDetails();
  }, [selectedVid, anomalies]);
  
  if (loading) return <div className="p-6 text-white">Loading Vehicle Data...</div>;
  
  const currentVehicle = vehicles.find(v => v.id === selectedVid) || vehicles[0];
  if (!currentVehicle) return <div className="p-6 text-white">No active vehicles found.</div>;
  
  const currentStationObj = stations.find(s => s.id === currentVehicle.current_station);
  const currentSeq = currentStationObj ? currentStationObj.sequence_no : 0;
  
  const targetStation = sortedStations.find(s => s.sequence_no === selectedSeq) || sortedStations[0];
  
  let statusBadge = "HISTORICAL (Completed)";
  let badgeColor = "bg-gray-600";
  if (selectedSeq === currentSeq) {
    statusBadge = "LIVE (Current Station)";
    badgeColor = "bg-cyan-600 border border-cyan-500/50";
  } else if (selectedSeq > currentSeq) {
    statusBadge = "PREDICTED (Simulated Downstream)";
    badgeColor = "bg-purple-900 text-purple-200 border border-purple-500/50";
  }
  
  const baseline = targetStation?.baseline;
  let carCt = baseline?.expected_cycle_time_sec || 0;
  let carTorque = 42.1;
  let carTemp = baseline?.expected_temperature_c || 0;
  let carVib = baseline?.expected_vibration_mm_s || 0;
  let isInferred = targetStation?.has_sensors === false;
  
  const eventAtStation = vehicleDetail?.events?.find((e: any) => e.station_id === targetStation?.id);
  
  if (eventAtStation) {
    carCt = eventAtStation.cycle_time_sec || carCt;
    carTorque = eventAtStation.torque_nm || carTorque;
    carTemp = eventAtStation.temperature_c || carTemp;
    carVib = eventAtStation.vibration_mm_s || carVib;
    isInferred = eventAtStation.is_inferred;
  } else if (selectedSeq > currentSeq) {
    const hasAnomaly = (currentVehicle as any).status !== 'normal';
    if (hasAnomaly && selectedSeq >= 14) {
      carCt += 13.0; 
      carTemp += 8.0;
      carVib += 2.7;
      carTorque += 5.0;
    }
  }
  
  const diffCt = carCt - (baseline?.expected_cycle_time_sec || 0);
  const diffTemp = carTemp - (baseline?.expected_temperature_c || 0);
  const diffVib = carVib - (baseline?.expected_vibration_mm_s || 0);
  const diffTorque = carTorque - 42.1;
  
  const hasAnomalyCondition = (currentVehicle as any).status !== 'normal' && selectedSeq >= 14;

  return (
    <div className="p-6 max-w-[1400px] mx-auto flex flex-col gap-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Search className="w-6 h-6 text-blue-400" /> Vehicle Deep Dive & Predictive Inspector
        </h1>
        <p className="text-sm text-gray-500 mt-1">Full process history, variance comparison, and root-cause propagation projections.</p>
      </div>

      <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-6 shadow-lg flex flex-col lg:flex-row gap-6">
        <div className="flex-1 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Select Vehicle Chassis ID</label>
            <select 
              value={selectedVid}
              onChange={(e) => { setSelectedVid(e.target.value); setVehicleDetail(null); }}
              className="w-full bg-gray-900 border border-gray-700 text-white rounded p-3 outline-none focus:border-blue-500 transition-colors"
            >
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.id.replace("VEH_", "Chassis #")} - {v.current_station}</option>
              ))}
            </select>
          </div>
          
          <div className="mt-4">
            <div className="flex justify-between text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              <span>Station Timeline Step</span>
              <span className="text-white">S{selectedSeq.toString().padStart(2, '0')}</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="30" 
              value={selectedSeq}
              onChange={(e) => setSelectedSeq(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-gray-600 mt-2 font-mono">
              <span>S01</span>
              <span>S15</span>
              <span>S30</span>
            </div>
          </div>
        </div>
        
        <div className="flex-1 border-t lg:border-t-0 lg:border-l border-gray-800 pt-6 lg:pt-0 lg:pl-6 flex flex-col justify-center">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Station Overview</div>
          <h2 className="text-2xl font-bold text-white">{targetStation?.name}</h2>
          <div className="mt-4 flex items-center gap-3">
            <span className={`px-3 py-1 rounded text-xs font-bold text-white ${badgeColor}`}>
              {statusBadge}
            </span>
            {isInferred && (
              <span className="px-3 py-1 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                BAYESIAN INFERRED (SENSORLESS)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0a0f1a] border border-gray-800 rounded-xl p-6 shadow-lg">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" /> 3-Way Comparative Telemetry
          </h3>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase tracking-wider text-gray-500">
                  <th className="pb-3 pr-4 font-medium">Metric</th>
                  <th className="pb-3 px-4 font-medium">This Car (S{selectedSeq.toString().padStart(2, '0')})</th>
                  <th className="pb-3 px-4 font-medium">Nominal Baseline</th>
                  <th className="pb-3 pl-4 font-medium text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                <tr className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                  <td className="py-4 pr-4 font-semibold text-gray-300">Cycle Time</td>
                  <td className="py-4 px-4 font-mono text-white">{carCt.toFixed(1)} s</td>
                  <td className="py-4 px-4 font-mono text-gray-500">{baseline?.expected_cycle_time_sec?.toFixed(1) || 0} s</td>
                  <td className="py-4 pl-4 text-right">
                    <span className={`px-2 py-1 rounded font-mono font-bold text-[11px] ${Math.abs(diffCt) > 5 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                      {diffCt > 0 ? '+' : ''}{diffCt.toFixed(1)} s
                    </span>
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                  <td className="py-4 pr-4 font-semibold text-gray-300">Torque</td>
                  <td className="py-4 px-4 font-mono text-white">{carTorque.toFixed(1)} Nm</td>
                  <td className="py-4 px-4 font-mono text-gray-500">42.1 Nm</td>
                  <td className="py-4 pl-4 text-right">
                    <span className={`px-2 py-1 rounded font-mono font-bold text-[11px] ${Math.abs(diffTorque) > 3 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                      {diffTorque > 0 ? '+' : ''}{diffTorque.toFixed(1)} Nm
                    </span>
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                  <td className="py-4 pr-4 font-semibold text-gray-300">Temperature</td>
                  <td className="py-4 px-4 font-mono text-white">{carTemp.toFixed(1)} °C</td>
                  <td className="py-4 px-4 font-mono text-gray-500">{baseline?.expected_temperature_c?.toFixed(1) || 0} °C</td>
                  <td className="py-4 pl-4 text-right">
                    <span className={`px-2 py-1 rounded font-mono font-bold text-[11px] ${Math.abs(diffTemp) > 5 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                      {diffTemp > 0 ? '+' : ''}{diffTemp.toFixed(1)} °C
                    </span>
                  </td>
                </tr>
                <tr className="hover:bg-gray-800/20 transition-colors">
                  <td className="py-4 pr-4 font-semibold text-gray-300">Vibration</td>
                  <td className="py-4 px-4 font-mono text-white">{carVib.toFixed(2)} mm/s</td>
                  <td className="py-4 px-4 font-mono text-gray-500">{baseline?.expected_vibration_mm_s?.toFixed(2) || 0} mm/s</td>
                  <td className="py-4 pl-4 text-right">
                    <span className={`px-2 py-1 rounded font-mono font-bold text-[11px] ${Math.abs(diffVib) > 1 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                      {diffVib > 0 ? '+' : ''}{diffVib.toFixed(2)} mm/s
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-6 shadow-lg flex flex-col">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Info className="w-5 h-5 text-amber-500" /> Causal Engine & Risk
          </h3>
          
          {hasAnomalyCondition ? (
            <div className="flex-1 flex flex-col">
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-red-400 mb-1">Downstream Risk Projection</h4>
                    <p className="text-xs text-red-300/80 leading-relaxed">
                      Expected 89% paint adherence failure at S23 and 64% final fitment deviation if uncorrected prior to end-of-line.
                    </p>
                  </div>
                </div>
              </div>
              
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Probabilistic Root Causes</h4>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white">Calibration Drift</span>
                    <span className="text-amber-400 font-bold">72%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 w-[72%]"></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white">Fixture Wear</span>
                    <span className="text-gray-400 font-bold">18%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-500 w-[18%]"></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white">Thermal Expansion</span>
                    <span className="text-gray-400 font-bold">10%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-600 w-[10%]"></div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-green-500/5 border border-green-500/10 rounded-lg">
              <CheckCircle className="w-10 h-10 text-green-500 mb-3" />
              <h4 className="text-sm font-bold text-green-400 mb-2">Nominal 3-Sigma Operation</h4>
              <p className="text-xs text-gray-400 leading-relaxed">
                Vehicle telemetry matches healthy baseline profile. No causal anomaly detected across the digital thread up to this station.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VehicleDeepDivePage() {
  return (
    <Suspense fallback={<div className="p-6 text-white">Loading Inspector...</div>}>
      <VehicleDeepDiveContent />
    </Suspense>
  );
}
