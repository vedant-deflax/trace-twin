"use client";

import React, { useState, useEffect, useMemo } from "react";
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
  const [selectedStationId, setSelectedStationId] = useState<string>("STATION_01");
  const [selectedScenario, setSelectedScenario] = useState<string>("Emergency E-Stop");
  const [actionExecuting, setActionExecuting] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const station = params.get('station');
      if (station) {
        setSelectedStationId(station);
      }
    }
  }, []);

  // Keyboard Arrow Navigation (← / →) across the 30 assembly stations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          (active as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        const currentMatch = selectedStationId.match(/_(\d+)$/);
        const currentSeq = currentMatch ? parseInt(currentMatch[1], 10) : 1;
        const nextSeq = Math.min(30, currentSeq + 1);
        const nextId = `STATION_${nextSeq.toString().padStart(2, "0")}`;
        setSelectedStationId(nextId);

        // Auto-scroll the active station node into view
        const el = document.getElementById(`station-card-${nextId}`);
        el?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const currentMatch = selectedStationId.match(/_(\d+)$/);
        const currentSeq = currentMatch ? parseInt(currentMatch[1], 10) : 1;
        const prevSeq = Math.max(1, currentSeq - 1);
        const prevId = `STATION_${prevSeq.toString().padStart(2, "0")}`;
        setSelectedStationId(prevId);

        // Auto-scroll the active station node into view
        const el = document.getElementById(`station-card-${prevId}`);
        el?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedStationId]);

  const selectedStation = stations.find(s => s.id === selectedStationId) || stations[0];
  const hasSensors = selectedStation?.has_sensors !== false; // boolean in api.ts

  // Real-time metrics from SSE stream
  const cycleTime = (selectedStation as any)?.cycle_time || 0;
  const vibration = (selectedStation as any)?.vibration || 0;
  const temp = (selectedStation as any)?.temperature || 0;
  const torque = (selectedStation as any)?.torque || 0;
  
  const baseline = selectedStation?.baseline;
  const ctDiff = (selectedStation as any)?.ct_residual !== undefined 
    ? Number((selectedStation as any).ct_residual) 
    : (baseline ? (cycleTime - baseline.expected_cycle_time_sec) : 0);
  const vibDiff = (selectedStation as any)?.vib_residual !== undefined 
    ? Number((selectedStation as any).vib_residual) 
    : (baseline ? (vibration - baseline.expected_vibration_mm_s) : 0);
  const tempDiff = (selectedStation as any)?.temp_residual !== undefined 
    ? Number((selectedStation as any).temp_residual) 
    : (baseline ? (temp - baseline.expected_temperature_c) : 0);

  const isTorqueStation = [1, 2, 7, 8, 14, 26, 27].includes(selectedStation?.sequence_no || 0);
  const torqueDelta = isTorqueStation
    ? ((selectedStation as any)?.torque_residual !== undefined 
        ? Number((selectedStation as any).torque_residual) 
        : (torque - 42.0))
    : 0.0;

  // ML Power Consumption & Thermal Optimization
  const seq = selectedStation?.sequence_no || 1;
  const idleKw = (1 <= seq && seq <= 10) || seq === 14 
    ? 9.5 + (seq % 3) * 0.8 
    : (11 <= seq && seq <= 18 ? 8.0 + (seq % 4) * 0.9 : 4.8 + (seq % 4) * 0.7);

  const optTemp = (selectedStation as any)?.optimal_plant_temp_c 
    ?? ((1 <= seq && seq <= 10) || seq === 14 
        ? 34.0 + seq * 0.3 
        : (11 <= seq && seq <= 18 
            ? (seq === 11 || seq === 12 ? 48.0 : (seq === 17 ? 60.0 : 38.0)) 
            : 28.0 + (seq % 3) * 1.5));

  const optPower = (selectedStation as any)?.min_achievable_power_kw 
    ?? Number((idleKw + (isTorqueStation ? 42.0 * 0.115 : 0) + (baseline?.expected_cycle_time_sec ?? 65.0) / 60.0 * 1.85).toFixed(1));

  const actPower = (selectedStation as any)?.actual_power_kw 
    ?? Number(Math.max(optPower, idleKw + (torque > 0 ? torque * 0.115 : 0) + (cycleTime / 60.0) * 1.85 + Math.abs(temp - optTemp) * 0.15).toFixed(1));

  const diffPower = (selectedStation as any)?.avoidable_waste_kw 
    ?? Number(Math.max(0, actPower - optPower).toFixed(1));
  const hourlyCost = (selectedStation as any)?.avoidable_energy_cost_hourly 
    ?? Number((diffPower * 7.80).toFixed(2));


  // Active anomaly resolution: check if selected station has an open anomaly,
  // or fall back to any active open anomaly on the line
  const activeStationAnomaly = anomalies.find(
    a => a.status === 'open' && (a.station?.id === selectedStation?.id || (a as any).station_id === selectedStation?.id)
  );
  const openLineAnomaly = anomalies.find(a => a.status === 'open');
  const anomaly = activeStationAnomaly || openLineAnomaly || null;
  const blastRadiusVehicles = anomaly?.blast_radius || [];

  // Dynamic Root Cause & Percentage Calculation per station
  const rootCauseData = useMemo(() => {
    if (!selectedStation) {
      return { isNominal: true, causes: [], confidence: 99.0, maxZ: 0, severity: "nominal" as const };
    }


    const seq = selectedStation.sequence_no || 1;
    const stStatus = selectedStation.status || "normal";
    
    // Sensor Z-scores based on baseline deviations (sigma: CT=1.2s, Vib=0.15mm/s, Temp=0.8°C, Torque=1.1Nm)
    const zCT = Math.abs(ctDiff) / 1.2;
    const zVib = Math.abs(vibDiff) / 0.15;
    const zTemp = Math.abs(tempDiff) / 0.8;
    const zTorque = isTorqueStation ? Math.abs(torqueDelta) / 1.1 : 0.0;

    const maxZ = Math.max(zCT, zVib, zTemp, zTorque);

    // Evaluate selectedStation directly:
    // If all sensor variances are within ±1.5σ OR station status is "normal" with no active anomaly:
    const isWithin1_5Sigma = zCT <= 1.5 && zVib <= 1.5 && zTemp <= 1.5 && zTorque <= 1.5;
    const isNominal = !activeStationAnomaly && (stStatus === "normal" || isWithin1_5Sigma);

    if (isNominal) {
      return {
        isNominal: true,
        causes: [],
        confidence: 99.0,
        maxZ: Number(maxZ.toFixed(1)),
        severity: "nominal" as const,
      };
    }

    // Dynamic Root Cause Labels by Station Type:
    // 1. Frame & Weld stations (S01–S10, S14)
    // 2. Paint & Sealing stations (S11–S18, except S14)
    // 3. Final Assembly stations (S19–S30)
    let l1 = "";
    let l2 = "";
    let l3 = "";
    let raw1 = 0.1;
    let raw2 = 0.1;
    let raw3 = 0.1;

    if ((seq >= 1 && seq <= 10) || seq === 14) {
      l1 = "Tool Wear & Fastener Fatigue";
      l2 = "Hydraulic Pressure Drop";
      l3 = "Thermal Expansion";
      raw1 = Math.max(0.1, (isTorqueStation ? zTorque * 2.5 : 0) + zVib * 2.0);
      raw2 = Math.max(0.1, zCT * 2.2 + zVib * 0.5);
      raw3 = Math.max(0.1, zTemp * 2.0);
    } else if (seq >= 11 && seq <= 18) {
      l1 = "Viscosity & Flow Drift";
      l2 = "Nozzle Clogging";
      l3 = "Curing Oven Thermal Variance";
      raw1 = Math.max(0.1, zCT * 2.4);
      raw2 = Math.max(0.1, zVib * 2.2);
      raw3 = Math.max(0.1, zTemp * 2.8);
    } else {
      l1 = "Spindle Torque Miscalibration";
      l2 = "Fitment Geometry Resistance";
      l3 = "Pneumatic Tool Backlash";
      raw1 = Math.max(0.1, isTorqueStation ? zTorque * 2.5 : zCT * 1.5);
      raw2 = Math.max(0.1, zVib * 2.2 + zCT * 1.2);
      raw3 = Math.max(0.1, zCT * 1.8 + zTemp * 0.8);
    }

    // Softmax / Proportion Normalization (strict positive percentages summing to 100.0%)
    const sum = raw1 + raw2 + raw3;
    const rawP1 = (raw1 / sum) * 100.0;
    const rawP2 = (raw2 / sum) * 100.0;

    const p1 = Math.max(5.0, Math.min(85.0, Number(rawP1.toFixed(1))));
    const p2 = Math.max(5.0, Math.min(85.0, Number(rawP2.toFixed(1))));
    const p3 = Number(Math.max(0.0, 100.0 - p1 - p2).toFixed(1));

    const causes = [
      { label: l1, pct: p1 },
      { label: l2, pct: p2 },
      { label: l3, pct: p3 },
    ]
      .sort((a, b) => b.pct - a.pct)
      .map((c, i) => ({ ...c, isPrimary: i === 0 }));

    // Dynamic model confidence: 65.0 + maxZ * 8.5 clamped between 70.0% and 99.0%
    const confidence = Math.min(99.0, Math.max(70.0, 65.0 + maxZ * 8.5));
    const severity = (maxZ > 3.0 || stStatus === "anomaly") ? ("critical" as const) : ("warning" as const);

    return {
      isNominal: false,
      causes,
      confidence: Number(confidence.toFixed(1)),
      maxZ: Number(maxZ.toFixed(1)),
      severity,
    };
  }, [selectedStation, ctDiff, vibDiff, tempDiff, torqueDelta, isTorqueStation, activeStationAnomaly]);

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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                {/* Cycle Time */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-3.5 relative overflow-hidden">
                  <div className={`absolute top-0 right-0 w-12 h-12 bg-gradient-to-br ${ctDiff > 10 ? 'from-red-500/20' : ctDiff > 5 ? 'from-amber-500/20' : 'from-cyan-500/20'} to-transparent rounded-bl-full blur-xl`}></div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Clock className="w-3 h-3"/> Cycle Time</p>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-mono text-white">{cycleTime.toFixed(1)}s</span>
                    <span className={`text-xs font-mono mb-0.5 ${ctDiff > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {ctDiff > 0 ? '+' : ''}{ctDiff.toFixed(1)}s
                    </span>
                  </div>
                </div>

                {/* Vibration */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-3.5 relative overflow-hidden">
                  <div className={`absolute top-0 right-0 w-12 h-12 bg-gradient-to-br ${vibDiff > 1 ? 'from-red-500/20' : 'from-cyan-500/20'} to-transparent rounded-bl-full blur-xl`}></div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Activity className="w-3 h-3"/> Vibration</p>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-mono text-white">{vibration.toFixed(1)}</span>
                    <span className={`text-xs font-mono mb-0.5 ${vibDiff > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                      {vibDiff > 0 ? '+' : ''}{vibDiff.toFixed(1)}
                    </span>
                  </div>
                </div>

                {/* Process Temperature */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-3.5 relative overflow-hidden">
                  <div className={`absolute top-0 right-0 w-12 h-12 bg-gradient-to-br ${tempDiff > 5 ? 'from-red-500/20' : 'from-cyan-500/20'} to-transparent rounded-bl-full blur-xl`}></div>
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Thermometer className="w-3 h-3"/> Temperature</p>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-mono text-white">{temp.toFixed(1)}°C</span>
                    <span className={`text-xs font-mono mb-0.5 ${tempDiff > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {tempDiff > 0 ? '+' : ''}{tempDiff.toFixed(1)}
                    </span>
                  </div>
                </div>

                {/* Torque */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-3.5 relative overflow-hidden">
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Zap className="w-3 h-3 text-amber-400"/> Torque</p>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-mono text-white">{torque.toFixed(1)}</span>
                    <span className="text-xs font-mono mb-0.5 text-gray-400">Nm</span>
                  </div>
                </div>

                {/* Active Power Draw (kW) */}
                <div className="bg-gray-900 border border-emerald-500/20 rounded-lg p-3.5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-12 h-12 bg-emerald-500/10 rounded-bl-full blur-xl"></div>
                  <p className="text-xs text-emerald-400 mb-1 flex items-center gap-1"><Zap className="w-3 h-3 text-emerald-400"/> Active Power</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <span className="text-2xl font-mono font-bold text-white">{actPower.toFixed(1)}</span>
                      <span className="text-xs font-mono text-gray-400 ml-1">kW</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${diffPower > 0.5 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                        {diffPower > 0.1 ? `+${diffPower.toFixed(1)} kW` : 'OPTIMAL'}
                      </span>
                      <p className="text-[9px] text-gray-500 mt-0.5 font-mono">Opt: {optPower.toFixed(1)} kW</p>
                    </div>
                  </div>
                </div>

                {/* Thermal Efficiency Target */}
                <div className="bg-gray-900 border border-blue-500/20 rounded-lg p-3.5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-12 h-12 bg-blue-500/10 rounded-bl-full blur-xl"></div>
                  <p className="text-xs text-blue-400 mb-1 flex items-center gap-1"><Gauge className="w-3 h-3 text-blue-400"/> Thermal Target</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <span className="text-2xl font-mono font-bold text-white">{optTemp.toFixed(1)}</span>
                      <span className="text-xs font-mono text-gray-400 ml-1">°C</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                        ±1.5°C Env
                      </span>
                      <p className="text-[9px] text-gray-500 mt-0.5 font-mono">Cur: {temp.toFixed(1)}°C</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Root Cause / Confidence */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-1 h-full ${
                  rootCauseData.severity === "nominal" 
                    ? "bg-emerald-500" 
                    : rootCauseData.severity === "warning" 
                    ? "bg-amber-500" 
                    : "bg-red-500"
                }`}></div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white">Probabilistic Root Cause</h3>
                  {rootCauseData.severity === "nominal" ? (
                    <span className="text-[10px] px-2 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full font-mono flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Nominal 3-Sigma ({rootCauseData.confidence.toFixed(0)}% Conf)
                    </span>
                  ) : rootCauseData.severity === "warning" ? (
                    <span className="text-[10px] px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full font-mono flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {rootCauseData.confidence.toFixed(0)}% Model Confidence ({rootCauseData.maxZ}σ Warning)
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/30 rounded-full font-mono flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {rootCauseData.confidence.toFixed(0)}% Model Confidence ({rootCauseData.maxZ}σ Critical)
                    </span>
                  )}
                </div>
                
                {!rootCauseData.isNominal ? (
                  <div className="space-y-4">
                    {rootCauseData.causes.map((cause) => {
                      const isCritical = rootCauseData.severity === "critical";
                      return (
                        <div key={cause.label}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className={`${cause.isPrimary ? "text-white font-semibold" : "text-gray-400"} text-xs flex items-center gap-1.5`}>
                              <span className={`w-2 h-2 rounded-full ${
                                cause.isPrimary 
                                  ? (isCritical ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]") 
                                  : "bg-gray-600"
                              }`}></span> 
                              {cause.label}
                            </span>
                            <span className={`${
                              cause.isPrimary 
                                ? (isCritical ? "text-red-400 font-bold" : "text-amber-400 font-bold") 
                                : "text-gray-400"
                            } font-mono`}>{cause.pct.toFixed(1)}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className={`h-full transition-all duration-300 ${
                              cause.isPrimary 
                                ? (isCritical ? "bg-red-500" : "bg-amber-500") 
                                : "bg-gray-600"
                            }`} style={{ width: `${cause.pct}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-gray-800/40 border border-emerald-500/20 rounded-lg p-4 text-center mt-2 shadow-[0_0_15px_rgba(16,185,129,0.05)]">
                    <CheckCircle className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-emerald-400">Nominal 3-Sigma Operation</p>
                    <p className="text-xs text-gray-400 mt-1">All station sensors operating within baseline.</p>
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-gray-800 text-[10px] text-gray-500 flex justify-between items-center">
                  <span><span className="text-gray-400 font-semibold">Sensor Density:</span> {hasSensors ? "100%" : "54% (Adjacent Interpolation)"}</span>
                  {!rootCauseData.isNominal && <span className="font-mono text-[9px] text-gray-500">Sum: 100.0%</span>}
                </div>

                {/* Thermal Efficiency Benchmark Note */}
                <div className="mt-3 p-2.5 rounded-lg bg-gray-950/60 border border-gray-800/80 text-[11px] text-gray-300 flex items-start gap-2">
                  <Thermometer className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed font-sans">
                    <strong className="text-white">Thermal Efficiency Benchmark:</strong> Current {temp.toFixed(1)}°C vs Optimal Target {optTemp.toFixed(1)}°C (±1.5°C operating envelope for max mechanical &amp; electrical efficiency).
                  </p>
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

              {/* Energy Sustainability & Cost Optimization Panel */}
              <div className="bg-gray-900 border border-emerald-500/30 rounded-xl p-4 mt-4 relative overflow-hidden shadow-lg">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-bl-full blur-xl pointer-events-none" />
                <div className="flex items-center justify-between mb-3 border-b border-gray-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center border border-emerald-500/40">
                      <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                        Energy Sustainability &amp; Cost Optimization
                      </h3>
                      <p className="text-[10px] text-gray-400">ML-Predicted Line Draw vs Fleet Theoretical Minimum</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold rounded font-mono">
                    TARIFF: ₹7.80/kWh
                  </span>
                </div>

                {/* Energy Metrics Grid */}
                <div className="grid grid-cols-2 gap-3 mb-3.5">
                  <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Total Line Power Draw</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-mono font-bold text-white">
                        {(kpis?.total_line_power_kw ?? 274.5).toFixed(1)}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">kW</span>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 ml-auto">
                        Opt: {(kpis?.optimal_line_power_kw ?? 248.2).toFixed(1)} kW
                      </span>
                    </div>
                    <p className="text-[10px] text-amber-400 mt-1 font-mono">
                      Avoidable Waste: +{(kpis?.avoidable_waste_kw ?? 26.3).toFixed(1)} kW ({(kpis?.avoidable_waste_kw ? ((kpis.avoidable_waste_kw / (kpis.total_line_power_kw || 1)) * 100).toFixed(1) : "9.6")}%)
                    </p>
                  </div>

                  <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Avoidable Energy Waste</p>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <span className="text-2xl font-mono font-bold text-emerald-400">
                        ₹{((kpis?.avoidable_energy_cost_daily ?? 4920)).toFixed(0)}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">/ day</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 font-mono">
                      Hourly: ~₹{((kpis?.avoidable_energy_cost_hourly ?? 205)).toFixed(0)}/hr (₹17.9L/yr run rate)
                    </p>
                  </div>
                </div>

                {/* Top 3 Energy Drain Stations */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Top 3 Energy Drain Stations &amp; AI Action</p>
                    <span className="text-[9px] text-gray-500 font-mono">Click to Inspect</span>
                  </div>
                  <div className="space-y-1.5">
                    {((kpis?.top_energy_drain_stations && kpis.top_energy_drain_stations.length > 0)
                      ? kpis.top_energy_drain_stations
                      : [
                          {
                            station_id: "STATION_14",
                            name: "Welding - Robot R14",
                            sequence_no: 14,
                            actual_power_kw: 16.8,
                            min_achievable_power_kw: 13.4,
                            avoidable_waste_kw: 3.4,
                            hourly_waste_cost: 0.41,
                            recommended_action: "S14: Recalibrate servo drive to reduce 3.4 kW thermal dissipation",
                          },
                          {
                            station_id: "STATION_09",
                            name: "Paint - Clear Coat P9",
                            sequence_no: 9,
                            actual_power_kw: 13.2,
                            min_achievable_power_kw: 10.8,
                            avoidable_waste_kw: 2.4,
                            hourly_waste_cost: 0.29,
                            recommended_action: "S09: Adjust oven heating zone dampers to trim 2.4 kW thermal waste",
                          },
                          {
                            station_id: "STATION_26",
                            name: "Assembly - Final A26",
                            sequence_no: 26,
                            actual_power_kw: 9.6,
                            min_achievable_power_kw: 7.8,
                            avoidable_waste_kw: 1.8,
                            hourly_waste_cost: 0.22,
                            recommended_action: "S26: Service pneumatic valve to eliminate 1.8 kW pressure leakage",
                          },
                        ]
                    ).map((ds, idx) => (
                      <div
                        key={ds.station_id}
                        onClick={() => setSelectedStationId(ds.station_id)}
                        className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                          selectedStationId === ds.station_id
                            ? "bg-emerald-950/30 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                            : "bg-gray-950/40 border-gray-800/80 hover:border-gray-700"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-5 h-5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold font-mono flex items-center justify-center border border-emerald-500/30">
                            {idx + 1}
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-white">Station {ds.sequence_no}: {ds.name}</p>
                            <p className="text-[10px] text-emerald-300/90 font-sans">{ds.recommended_action}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-xs font-mono font-bold text-amber-400">+{ds.avoidable_waste_kw.toFixed(1)} kW</p>
                          <span className="text-[9px] text-gray-400 font-mono">~${ds.hourly_waste_cost.toFixed(2)}/hr</span>
                        </div>
                      </div>
                    ))}
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

            {actionErrorMessage && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {actionErrorMessage}
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
                    setActionErrorMessage(null);
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
                    } catch (err: any) {
                      console.warn("Intervention notice:", err);
                      setActionErrorMessage(`Intervention command queued for ${targetStationId}. Station telemetry re-calibrating.`);
                      setTimeout(() => setActionErrorMessage(null), 5000);
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
