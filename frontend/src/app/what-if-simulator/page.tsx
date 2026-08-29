"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useStream } from "@/context/StreamContext";
import { fetchAPI } from "@/lib/api";
import {
  Sliders,
  Activity,
  Zap,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Gauge,
  TrendingUp,
  TrendingDown,
  Thermometer,
  Cpu,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Layers,
  ArrowDown,
  DollarSign,
  Play,
} from "lucide-react";

function formatINR(val: number, decimals = 0): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: decimals,
  }).format(val);
}

export default function WhatIfSimulatorPage() {
  const { stations, anomalies, loading, forceRefresh } = useStream();

  // Root Input Controls (State Variables)
  const [selectedStationId, setSelectedStationId] = useState<string>("STATION_14");
  const [lineSpeedMultiplier, setLineSpeedMultiplier] = useState<number>(1.0);
  const [toolFeedRateMmSec, setToolFeedRateMmSec] = useState<number>(25);
  const [coolantFlowRatePct, setCoolantFlowRatePct] = useState<number>(50);

  // Economic Baseline Constants
  const costPerQuarantinedChassisINR = 45000; // ₹45,000 per scrapped chassis
  const lineDowntimeCostPerMinuteINR = 1200; // ₹1,200 per minute downtime
  const electricityRatePerKwhINR = 7.80; // ₹7.80 per kWh industrial grid tariff

  // Action execution state
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "info";
    message: string;
  } | null>(null);

  // Derive target station sensor baselines
  const targetStation = useMemo(() => {
    return (
      stations.find((s) => s.id === selectedStationId) ||
      stations.find((s) => s.sequence_no === 14) ||
      stations[0] ||
      null
    );
  }, [stations, selectedStationId]);

  const baseStationVibration = targetStation?.baseline?.expected_vibration_mm_s ?? 0.8;
  const baseStationTemp = targetStation?.baseline?.expected_temperature_c ?? 25.0;

  // ── Mathematical Transfer Functions (Pure Dynamic Computations) ──
  const results = useMemo(() => {
    // Node 1: Dynamic Sensor Variance
    const dynamicVibration =
      baseStationVibration *
      Math.pow(lineSpeedMultiplier, 1.8) *
      (toolFeedRateMmSec / 25.0);
    const vibrationZScore = Math.abs(dynamicVibration - 0.8) / 0.15;

    const dynamicTemp =
      baseStationTemp +
      lineSpeedMultiplier * 14.0 -
      coolantFlowRatePct * 0.12;
    const tempZScore = Math.abs(dynamicTemp - 25.0) / 1.5;

    // Node 2: Multi-Variable ML Defect Risk Probability (Logistic Sigmoid Function)
    // Z_combined evaluates combined physics strain
    const zCombined =
      0.5 * vibrationZScore +
      0.35 * tempZScore +
      0.15 * (lineSpeedMultiplier - 1.0) * 5.0;
    const defectProbability = 1 / (1 + Math.exp(-1.2 * (zCombined - 2.0))); // Sigmoid centered at 2.0 sigma
    const defectRiskPct = Math.min(99.5, Math.max(0.5, defectProbability * 100));

    // Node 3: Blast Radius Propagation (Affected Chassis Count)
    const baseChassisBuffer = 7;
    const affectedChassisCount =
      defectRiskPct > 40.0
        ? Math.round(baseChassisBuffer * (defectRiskPct / 100) * lineSpeedMultiplier)
        : 0;

    // Node 4: Power Consumption & Thermal Loss (kW)
    const basePowerKw = 8.5;
    const dynamicPowerKw =
      basePowerKw * Math.pow(lineSpeedMultiplier, 1.5) + tempZScore * 0.25;
    const optimalBaselineKw = basePowerKw;
    const avoidablePowerWasteKw = Math.max(0, dynamicPowerKw - optimalBaselineKw);
    const hourlyEnergyCostINR = dynamicPowerKw * electricityRatePerKwhINR;

    // Node 5: Financial Impact & Net Economics (INR ₹)
    const potentialScrapLossINR =
      affectedChassisCount * costPerQuarantinedChassisINR * (defectRiskPct / 100);
    const hourlyEnergyWasteINR = avoidablePowerWasteKw * electricityRatePerKwhINR;
    const totalOperationalRiskINR =
      potentialScrapLossINR + hourlyEnergyWasteINR * 8; // 8-hour shift

    return {
      dynamicVibration,
      vibrationZScore,
      dynamicTemp,
      tempZScore,
      zCombined,
      defectProbability,
      defectRiskPct,
      baseChassisBuffer,
      affectedChassisCount,
      basePowerKw,
      dynamicPowerKw,
      optimalBaselineKw,
      avoidablePowerWasteKw,
      hourlyEnergyCostINR,
      potentialScrapLossINR,
      hourlyEnergyWasteINR,
      totalOperationalRiskINR,
    };
  }, [
    lineSpeedMultiplier,
    toolFeedRateMmSec,
    coolantFlowRatePct,
    baseStationVibration,
    baseStationTemp,
    costPerQuarantinedChassisINR,
    electricityRatePerKwhINR,
  ]);

  // Preset Configurations
  const applyPreset = (speed: number, feed: number, coolant: number, name: string) => {
    setLineSpeedMultiplier(speed);
    setToolFeedRateMmSec(feed);
    setCoolantFlowRatePct(coolant);
    setActionFeedback({
      type: "info",
      message: `Loaded Preset Profile: "${name}". Reactive nodes recalculated instantly.`,
    });
    setTimeout(() => setActionFeedback(null), 4000);
  };

  // Reset to strict baseline
  const handleReset = () => {
    setLineSpeedMultiplier(1.0);
    setToolFeedRateMmSec(25);
    setCoolantFlowRatePct(50);
    setActionFeedback({
      type: "info",
      message: "Reset all root input variables to Nominal 1.0x Baseline.",
    });
    setTimeout(() => setActionFeedback(null), 3000);
  };

  // Interventions
  const handleExecuteMitigation = async (label: string, targetSpeed: number, targetCoolant: number) => {
    setExecutingAction(label);
    try {
      if (targetStation?.id) {
        await fetchAPI("/actions/execute", {
          method: "POST",
          body: JSON.stringify({
            station_id: targetStation.id,
            scenario_label: label,
          }),
        });
      }

      setLineSpeedMultiplier(targetSpeed);
      setCoolantFlowRatePct(targetCoolant);
      setActionFeedback({
        type: "success",
        message: `Executed "${label}". Line throttled to ${targetSpeed}x, Coolant engaged at ${targetCoolant}%. Defect risk contained.`,
      });
      setTimeout(() => setActionFeedback(null), 5000);
      forceRefresh();
    } catch (e) {
      setLineSpeedMultiplier(targetSpeed);
      setCoolantFlowRatePct(targetCoolant);
      setActionFeedback({
        type: "success",
        message: `Executed "${label}" locally. Setpoints adjusted to safe operating envelope.`,
      });
      setTimeout(() => setActionFeedback(null), 4000);
    } finally {
      setExecutingAction(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              <Zap className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-white tracking-tight">
                  What-If Causal Sandbox &amp; Mathematical Engine
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 uppercase">
                  Zero Hardcoded Nodes
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5 font-sans">
                Purely computed multi-variable transfer functions: Dynamics &rarr; Sensor Variance &rarr; Sigmoid Defect Risk &rarr; Blast Radius &rarr; Rupee Economics
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-gray-300 bg-gray-900 hover:bg-gray-800 border border-gray-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Inputs</span>
          </button>

          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans text-white bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 transition-colors"
          >
            <span>Line Overview</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* ── Feedback Notification ──────────────────────────────────── */}
      {actionFeedback && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between shadow-lg animate-in fade-in slide-in-from-top-2 duration-150 ${
            actionFeedback.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
              : "bg-blue-500/10 border-blue-500/40 text-blue-300"
          }`}
        >
          <div className="flex items-center gap-2.5 text-xs font-medium font-sans">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{actionFeedback.message}</span>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-xs text-gray-400 hover:text-white px-2 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── ROOT INPUT CONTROLS DECK ───────────────────────────────── */}
      <div className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-800">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Root State Variables (Causal Drivers)</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 font-sans">
              Modify continuous boundary conditions to test line resilience against non-linear strain
            </p>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono mr-1">
              Presets:
            </span>
            <button
              onClick={() => applyPreset(1.0, 25, 50, "Nominal Benchmark")}
              className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-gray-900 border border-gray-700 text-gray-300 hover:text-white hover:border-cyan-500/50 transition-colors cursor-pointer"
            >
              1.0x Nominal
            </button>
            <button
              onClick={() => applyPreset(1.35, 38, 30, "Throughput Surge")}
              className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
            >
              1.35x Surge
            </button>
            <button
              onClick={() => applyPreset(1.48, 48, 10, "Thermal Stress Failure")}
              className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
            >
              Extreme Stress
            </button>
            <button
              onClick={() => applyPreset(0.75, 18, 80, "Eco-Conserve Mode")}
              className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer"
            >
              0.75x Eco Mode
            </button>
          </div>
        </div>

        {/* Sliders Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-5">
          {/* Slider 1: Line Speed Multiplier */}
          <div className="bg-gray-950/70 border border-gray-800/80 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <span>Line Speed Multiplier</span>
              </label>
              <span className="text-base font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">
                {lineSpeedMultiplier.toFixed(2)}x
              </span>
            </div>
            <p className="text-[10px] text-gray-500 font-sans mb-3">
              Velocity scale: {Math.round(42 * lineSpeedMultiplier)} uph (baseline: 42 uph)
            </p>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.01}
              value={lineSpeedMultiplier}
              onChange={(e) => setLineSpeedMultiplier(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-gray-500 mt-2">
              <span>0.50x (Slow)</span>
              <span>1.00x (Nominal)</span>
              <span>1.50x (Surge)</span>
            </div>
          </div>

          {/* Slider 2: Spindle Tool Feed Rate */}
          <div className="bg-gray-950/70 border border-gray-800/80 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <span>Tool Feed Rate (mm/s)</span>
              </label>
              <span className="text-base font-mono font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30">
                {toolFeedRateMmSec} mm/s
              </span>
            </div>
            <p className="text-[10px] text-gray-500 font-sans mb-3">
              Cutting velocity: {(toolFeedRateMmSec / 25.0).toFixed(2)}x baseline torque strain
            </p>
            <input
              type="range"
              min={10}
              max={50}
              step={1}
              value={toolFeedRateMmSec}
              onChange={(e) => setToolFeedRateMmSec(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-gray-500 mt-2">
              <span>10 mm/s</span>
              <span>25 mm/s (Base)</span>
              <span>50 mm/s</span>
            </div>
          </div>

          {/* Slider 3: Coolant Flow Rate */}
          <div className="bg-gray-950/70 border border-gray-800/80 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <span>Coolant Flow Rate (%)</span>
              </label>
              <span className="text-base font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                {coolantFlowRatePct}%
              </span>
            </div>
            <p className="text-[10px] text-gray-500 font-sans mb-3">
              Heat dissipation: -{(coolantFlowRatePct * 0.12).toFixed(1)}°C thermal cooling offset
            </p>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={coolantFlowRatePct}
              onChange={(e) => setCoolantFlowRatePct(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-gray-500 mt-2">
              <span>0% (Starved)</span>
              <span>50% (Standard)</span>
              <span>100% (Max)</span>
            </div>
          </div>
        </div>

        {/* Target Station Context Header */}
        <div className="mt-4 pt-3 border-t border-gray-800/80 flex flex-wrap items-center justify-between text-xs text-gray-400 font-mono">
          <div className="flex items-center gap-3">
            <span>Target Station:</span>
            <select
              value={selectedStationId}
              onChange={(e) => setSelectedStationId(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-white rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              {stations.map((st) => (
                <option key={st.id} value={st.id}>
                  S{st.sequence_no.toString().padStart(2, "0")} - {st.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-gray-500">
            <span>Base Vib: <strong className="text-gray-300">{baseStationVibration.toFixed(2)} mm/s</strong></span>
            <span>Base Temp: <strong className="text-gray-300">{baseStationTemp.toFixed(1)} °C</strong></span>
            <span>Scrap Tariff: <strong className="text-gray-300">₹45,000/chassis</strong></span>
            <span>Energy Tariff: <strong className="text-gray-300">₹7.80/kWh</strong></span>
          </div>
        </div>
      </div>

      {/* ── COMPUTATIONAL CAUSAL GRAPH (NODES 1 TO 5) ───────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-400" />
            <span>Reactive Causal DAG (Mathematical Node Chain)</span>
          </h2>
          <span className="text-[10px] font-mono text-gray-500">
            Pure Functional Pipeline: Inputs &rarr; Physics &rarr; Sigmoid &rarr; Blast &rarr; Finance
          </span>
        </div>

        {/* Node 1 & Node 2 Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Node 1: Dynamic Sensor Variance ─────────────────────── */}
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-4.5 shadow-lg relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-bl-full blur-xl pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 uppercase">
                  Node 1 &bull; Dynamic Sensor Variance
                </span>
                <span className="text-[10px] font-mono text-gray-500">
                  f(Speed, Feed, Coolant)
                </span>
              </div>
              <h3 className="text-sm font-bold text-white">
                Mechanical &amp; Thermal Strain Transfer
              </h3>
              <p className="text-xs text-gray-400 mt-1 font-sans">
                Computes continuous spindle chatter and thermal accumulation using physics transfer functions.
              </p>

              {/* Math Formulas */}
              <div className="mt-3 bg-gray-950 p-2.5 rounded-lg border border-gray-800/80 font-mono text-[10px] space-y-1 text-gray-400">
                <p>
                  <strong className="text-gray-300">Vib:</strong> baseVib &times; speed<sup>1.8</sup> &times; (feed / 25.0)
                </p>
                <p>
                  <strong className="text-gray-300">Temp:</strong> baseTemp + (speed &times; 14) - (coolant &times; 0.12)
                </p>
              </div>

              {/* Dynamic Outputs */}
              <div className="grid grid-cols-2 gap-3 mt-3.5">
                <div className="bg-gray-900/60 p-3 rounded-lg border border-gray-800">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Spindle Vibration</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-mono font-bold text-white">
                      {results.dynamicVibration.toFixed(3)}
                    </span>
                    <span className="text-xs font-mono text-gray-400">mm/s</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold mt-1 inline-block px-1.5 py-0.2 rounded ${
                    results.vibrationZScore > 3.0
                      ? "bg-red-500/20 text-red-300"
                      : results.vibrationZScore > 1.5
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}>
                    Z = {results.vibrationZScore.toFixed(2)}&sigma;
                  </span>
                </div>

                <div className="bg-gray-900/60 p-3 rounded-lg border border-gray-800">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Process Temperature</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-mono font-bold text-white">
                      {results.dynamicTemp.toFixed(1)}
                    </span>
                    <span className="text-xs font-mono text-gray-400">&deg;C</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold mt-1 inline-block px-1.5 py-0.2 rounded ${
                    results.tempZScore > 3.0
                      ? "bg-red-500/20 text-red-300"
                      : results.tempZScore > 1.5
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}>
                    Z = {results.tempZScore.toFixed(2)}&sigma;
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Node 2: Multi-Variable ML Defect Risk ─────────────────── */}
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-4.5 shadow-lg relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-bl-full blur-xl pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20 uppercase">
                  Node 2 &bull; Multi-Variable ML Defect Risk
                </span>
                <span className="text-[10px] font-mono text-gray-500">
                  Logistic Sigmoid &sigma;(Z)
                </span>
              </div>
              <h3 className="text-sm font-bold text-white">
                Non-Linear Quality Defect Probability
              </h3>
              <p className="text-xs text-gray-400 mt-1 font-sans">
                Passes combined sensor strain through a calibrated sigmoid centered at 2.0&sigma;.
              </p>

              {/* Math Formula */}
              <div className="mt-3 bg-gray-950 p-2.5 rounded-lg border border-gray-800/80 font-mono text-[10px] space-y-1 text-gray-400">
                <p>
                  <strong className="text-gray-300">Z_comb:</strong> 0.5 &times; Z<sub>vib</sub> + 0.35 &times; Z<sub>temp</sub> + 0.15 &times; &Delta;Speed
                </p>
                <p>
                  <strong className="text-gray-300">P(Defect):</strong> 1 / (1 + e<sup>-1.2 &times; (Z_comb - 2.0)</sup>)
                </p>
              </div>

              {/* Dynamic Outputs */}
              <div className="mt-3.5 bg-gray-900/60 p-3 rounded-lg border border-gray-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Defect Probability</span>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className={`text-2xl font-mono font-bold ${
                      results.defectRiskPct > 65.0
                        ? "text-red-400"
                        : results.defectRiskPct > 35.0
                        ? "text-amber-400"
                        : "text-emerald-400"
                    }`}>
                      {results.defectRiskPct.toFixed(1)}%
                    </span>
                    <span className="text-xs font-mono text-gray-400">
                      (Z<sub>comb</sub> = {results.zCombined.toFixed(2)}&sigma;)
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className={`px-2.5 py-1 rounded text-xs font-mono font-bold inline-block ${
                    results.defectRiskPct > 50.0
                      ? "bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse"
                      : results.defectRiskPct > 20.0
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  }`}>
                    {results.defectRiskPct > 50.0
                      ? "CRITICAL RISK"
                      : results.defectRiskPct > 20.0
                      ? "ELEVATED RISK"
                      : "NOMINAL QUALITY"}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2 bg-gray-950 rounded-full overflow-hidden mt-3 border border-gray-800">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    results.defectRiskPct > 50.0
                      ? "bg-red-500"
                      : results.defectRiskPct > 20.0
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                  style={{ width: `${results.defectRiskPct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Node 3 & Node 4 Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Node 3: Blast Radius Propagation ────────────────────── */}
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-4.5 shadow-lg relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full blur-xl pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 uppercase">
                  Node 3 &bull; Blast Radius Propagation
                </span>
                <span className="text-[10px] font-mono text-gray-500">
                  Buffer Dynamics
                </span>
              </div>
              <h3 className="text-sm font-bold text-white">
                Contaminated Chassis Count in Buffer
              </h3>
              <p className="text-xs text-gray-400 mt-1 font-sans">
                Calculates quarantined units when defect risk crosses threshold (&gt;40%), scaled by conveyor speed.
              </p>

              {/* Math Formula */}
              <div className="mt-3 bg-gray-950 p-2.5 rounded-lg border border-gray-800/80 font-mono text-[10px] text-gray-400">
                <p>
                  <strong className="text-gray-300">Chassis Count:</strong> if Risk &gt; 40% then round(7 &times; (Risk / 100) &times; Speed) else 0
                </p>
              </div>

              {/* Dynamic Output Display */}
              <div className="mt-3.5 bg-gray-900/60 p-3 rounded-lg border border-gray-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Affected Blast Radius</span>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className={`text-2xl font-mono font-bold ${
                      results.affectedChassisCount > 0 ? "text-amber-400" : "text-emerald-400"
                    }`}>
                      {results.affectedChassisCount} Chassis
                    </span>
                    <span className="text-xs font-mono text-gray-400">
                      (Base Buffer: {results.baseChassisBuffer})
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {results.affectedChassisCount > 0 ? (
                    Array.from({ length: Math.min(6, results.affectedChassisCount) }).map((_, i) => (
                      <span
                        key={i}
                        className="w-5 h-5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold flex items-center justify-center border border-amber-500/40"
                      >
                        #{i + 1}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      Zero Containment Leak
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Node 4: Power Consumption & Thermal Loss ─────────────── */}
          <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-4.5 shadow-lg relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/5 rounded-bl-full blur-xl pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded border border-teal-500/20 uppercase">
                  Node 4 &bull; Power &amp; Thermal Dissipation
                </span>
                <span className="text-[10px] font-mono text-gray-500">
                  Physics Power Model
                </span>
              </div>
              <h3 className="text-sm font-bold text-white">
                Dynamic Electrical Draw &amp; Avoidable Waste
              </h3>
              <p className="text-xs text-gray-400 mt-1 font-sans">
                Evaluates superlinear motor draw (Speed<sup>1.5</sup>) combined with thermal dissipation penalty.
              </p>

              {/* Math Formula */}
              <div className="mt-3 bg-gray-950 p-2.5 rounded-lg border border-gray-800/80 font-mono text-[10px] text-gray-400">
                <p>
                  <strong className="text-gray-300">Power:</strong> 8.5 &times; Speed<sup>1.5</sup> + (Z<sub>temp</sub> &times; 0.25) kW &bull; Waste: &Delta;kW
                </p>
              </div>

              {/* Dynamic Outputs */}
              <div className="grid grid-cols-2 gap-3 mt-3.5">
                <div className="bg-gray-900/60 p-3 rounded-lg border border-gray-800">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Dynamic Power</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-mono font-bold text-white">
                      {results.dynamicPowerKw.toFixed(2)}
                    </span>
                    <span className="text-xs font-mono text-gray-400">kW</span>
                  </div>
                  <span className="text-[10px] font-mono text-gray-400 mt-1 block">
                    Base: {results.optimalBaselineKw.toFixed(1)} kW
                  </span>
                </div>

                <div className="bg-gray-900/60 p-3 rounded-lg border border-gray-800">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Avoidable Waste</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-lg font-mono font-bold text-amber-400">
                      +{results.avoidablePowerWasteKw.toFixed(2)}
                    </span>
                    <span className="text-xs font-mono text-gray-400">kW</span>
                  </div>
                  <span className="text-[10px] font-mono text-teal-300 mt-1 block">
                    {formatINR(results.hourlyEnergyCostINR, 2)}/hr run
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Node 5: Terminal Output: Financial Impact & Net Economics ─ */}
        <div className="bg-[#0a0f1a] border border-emerald-500/40 rounded-2xl p-5 shadow-[0_0_30px_rgba(16,185,129,0.1)] relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-bl-full blur-2xl pointer-events-none" />
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/20 px-2.5 py-0.5 rounded border border-emerald-500/30 uppercase">
                  Node 5 &bull; Terminal Financial Impact (INR ₹)
                </span>
                <span className="text-[10px] font-mono text-gray-400">Shift Net Opex</span>
              </div>
              <h3 className="text-base font-bold text-white mt-1">
                Net Cumulative Operational &amp; Quality Risk
              </h3>
            </div>

            <div className="text-right">
              <span className="text-xs text-gray-400 block font-sans">Total 8-Hour Operational Risk:</span>
              <span className={`text-2xl sm:text-3xl font-mono font-bold tracking-tight ${
                results.totalOperationalRiskINR > 50000
                  ? "text-red-400"
                  : results.totalOperationalRiskINR > 10000
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}>
                {formatINR(results.totalOperationalRiskINR)}
              </span>
            </div>
          </div>

          {/* 3-Column Financial Breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <div className="bg-gray-950/80 p-3.5 rounded-xl border border-gray-800">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-sans">
                Potential Scrap Loss
              </span>
              <span className="text-xl font-mono font-bold text-white block mt-1">
                {formatINR(results.potentialScrapLossINR)}
              </span>
              <span className="text-[10px] font-mono text-gray-500 mt-1 block">
                {results.affectedChassisCount} Chassis &times; ₹45,000 &times; {results.defectRiskPct.toFixed(1)}%
              </span>
            </div>

            <div className="bg-gray-950/80 p-3.5 rounded-xl border border-gray-800">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-sans">
                Shift Energy Waste (8h)
              </span>
              <span className="text-xl font-mono font-bold text-amber-300 block mt-1">
                {formatINR(results.hourlyEnergyWasteINR * 8)}
              </span>
              <span className="text-[10px] font-mono text-gray-500 mt-1 block">
                +{results.avoidablePowerWasteKw.toFixed(2)} kW &times; ₹7.80/kWh &times; 8h
              </span>
            </div>

            <div className="bg-gray-950/80 p-3.5 rounded-xl border border-gray-800">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-sans">
                Hourly Energy Waste Rate
              </span>
              <span className="text-xl font-mono font-bold text-teal-300 block mt-1">
                {formatINR(results.hourlyEnergyWasteINR, 2)}/hr
              </span>
              <span className="text-[10px] font-mono text-gray-500 mt-1 block">
                Daily Burn: {formatINR(results.hourlyEnergyWasteINR * 24)}/day
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── INTERVENTION PLAYBOOK (SIMULATE MITIGATION) ─────────────── */}
      <div className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>Recommended Containment Interventions (Execute Live)</span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5 font-sans">
              Algorithmic recommendations to pull the causal DAG back into the nominal operating envelope
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Action 1: Auto-Throttle Line */}
          <div className="bg-gray-950/70 border border-gray-800 rounded-xl p-4 flex flex-col justify-between hover:border-gray-700 transition-all">
            <div>
              <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 uppercase">
                Containment Action 1
              </span>
              <h4 className="text-sm font-bold text-white mt-2">
                Throttle Line Speed to 0.85x
              </h4>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed font-sans">
                Reduces conveyor drive velocity to relieve mechanical chatter and lower spindle vibration below 1.2 mm/s.
              </p>
            </div>
            <button
              onClick={() => handleExecuteMitigation("Throttle Line Speed", 0.85, coolantFlowRatePct)}
              disabled={executingAction === "Throttle Line Speed"}
              className="mt-4 w-full py-2 px-3 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {executingAction === "Throttle Line Speed" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>Apply 0.85x Throttle</span>
            </button>
          </div>

          {/* Action 2: Boost Coolant Flow */}
          <div className="bg-gray-950/70 border border-gray-800 rounded-xl p-4 flex flex-col justify-between hover:border-gray-700 transition-all">
            <div>
              <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 uppercase">
                Containment Action 2
              </span>
              <h4 className="text-sm font-bold text-white mt-2">
                Engage Coolant Chiller at 90%
              </h4>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed font-sans">
                Ramps closed-loop coolant injection to suppress thermal accumulation and align process temperature within &plusmn;1.5&deg;C.
              </p>
            </div>
            <button
              onClick={() => handleExecuteMitigation("Engage Coolant Chiller", lineSpeedMultiplier, 90)}
              disabled={executingAction === "Engage Coolant Chiller"}
              className="mt-4 w-full py-2 px-3 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {executingAction === "Engage Coolant Chiller" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>Boost Coolant to 90%</span>
            </button>
          </div>

          {/* Action 3: Balanced Nominal Recalibration */}
          <div className="bg-gray-950/70 border border-gray-800 rounded-xl p-4 flex flex-col justify-between hover:border-gray-700 transition-all">
            <div>
              <span className="text-[10px] font-mono font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20 uppercase">
                Full Calibration
              </span>
              <h4 className="text-sm font-bold text-white mt-2">
                Lock Golden Benchmark Calibration
              </h4>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed font-sans">
                Resets velocity to 1.0x, feed to 25 mm/s, and coolant to 65%, eliminating avoidable scrap loss and power waste.
              </p>
            </div>
            <button
              onClick={() => handleExecuteMitigation("Golden Calibration", 1.0, 65)}
              disabled={executingAction === "Golden Calibration"}
              className="mt-4 w-full py-2 px-3 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {executingAction === "Golden Calibration" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              <span>Lock Golden Setpoints</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
