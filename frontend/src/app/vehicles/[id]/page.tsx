"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchAPI, VehicleDetail } from "@/lib/api";
import {
  ArrowLeft,
  Clock,
  Zap,
  Thermometer,
  AlertTriangle,
  Radio,
  CheckCircle,
} from "lucide-react";

export default function VehiclePage() {
  const params = useParams();
  const vehicleId = params.id as string;
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAPI<VehicleDetail>(`/vehicles/${vehicleId}`);
        setVehicle(data);
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [vehicleId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !vehicle) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-400">{error || "Vehicle not found"}</p>
        </div>
      </div>
    );
  }

  // Find anomalous stations (Station 14)
  const anomalousStations = new Set(["STATION_14"]);
  const inferredStations = new Set([
    "STATION_04",
    "STATION_09",
    "STATION_16",
    "STATION_22",
    "STATION_27",
  ]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <a href="/" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white mb-4 transition-colors">
        <ArrowLeft className="w-3 h-3" /> Back to Line Overview
      </a>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-cyan-500/15 flex items-center justify-center">
          <span className="text-cyan-400 font-bold text-sm">{vehicle.id.replace("VEH_", "#")}</span>
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Vehicle {vehicle.id.replace("VEH_", "#")}</h1>
          <p className="text-xs text-gray-500">
            {vehicle.model} • Entered line at{" "}
            {new Date(vehicle.line_entry_ts).toLocaleTimeString()}
          </p>
        </div>
      </div>

      <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
        <Radio className="w-4 h-4 text-cyan-400" />
        Digital Thread — Station-by-Station Timeline
      </h2>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-800" />

        <div className="space-y-1">
          {vehicle.events.map((event, i) => {
            const isAnomaly = anomalousStations.has(event.station_id);
            const isInferred = inferredStations.has(event.station_id) || event.is_inferred;

            return (
              <div
                key={event.id}
                className={`relative flex items-start gap-4 pl-10 py-3 pr-4 rounded-lg transition-all ${
                  isAnomaly
                    ? "bg-red-500/5 border border-red-500/20"
                    : isInferred
                    ? "bg-purple-500/5 border border-purple-500/15"
                    : "hover:bg-gray-900/50"
                }`}
              >
                {/* Timeline dot */}
                <div
                  className={`absolute left-3.5 top-5 w-3 h-3 rounded-full border-2 ${
                    isAnomaly
                      ? "bg-red-500 border-red-400"
                      : isInferred
                      ? "bg-purple-500 border-purple-400"
                      : "bg-gray-700 border-gray-600"
                  }`}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      S{event.station_id.replace("STATION_", "")}
                    </span>
                    {isAnomaly && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">
                        ANOMALY
                      </span>
                    )}
                    {isInferred && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold">
                        INFERRED
                      </span>
                    )}
                    <span className="text-[9px] text-gray-600 ml-auto">
                      {event.source_system}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 mt-1.5 text-xs">
                    <span className="flex items-center gap-1 text-gray-400">
                      <Clock className="w-3 h-3" />
                      {event.cycle_time_sec?.toFixed(1)}s
                    </span>
                    <span className="flex items-center gap-1 text-gray-400">
                      <Zap className="w-3 h-3" />
                      {event.vibration_mm_s?.toFixed(2)} mm/s
                    </span>
                    <span className="flex items-center gap-1 text-gray-400">
                      <Thermometer className="w-3 h-3" />
                      {event.temperature_c?.toFixed(1)}°C
                    </span>
                  </div>

                  {isAnomaly && event.cycle_time_sec && (
                    <div className="mt-1.5 text-[10px] text-red-400">
                      Residual: +{(event.cycle_time_sec - 52).toFixed(1)}s cycle time deviation
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
