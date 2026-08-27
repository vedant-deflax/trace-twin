"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { fetchAPI, Station, AnomalyListItem, VehicleListItem, FactoryKPIs } from "@/lib/api";

interface StreamContextProps {
  stations: Station[];
  anomalies: AnomalyListItem[];
  vehicles: VehicleListItem[];
  kpis: FactoryKPIs | null;
  loading: boolean;
  error: string | null;
  forceRefresh: () => void;
}

const StreamContext = createContext<StreamContextProps | undefined>(undefined);

export function StreamProvider({ children }: { children: React.ReactNode }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyListItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleListItem[]>([]);
  const [kpis, setKpis] = useState<FactoryKPIs | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const forceRefresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let mounted = true;

    // Connect to Server-Sent Events stream
    const sse = new EventSource(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/stream/factory`);

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (mounted) {
          if (data.stations) setStations(data.stations);
          if (data.anomalies) setAnomalies(data.anomalies);
          if (data.vehicles) setVehicles(data.vehicles);
          if (data.kpis) setKpis(data.kpis);
          setLoading(false);
          setError(null);
        }
      } catch (err: any) {
        console.error("Failed to parse SSE payload:", err);
      }
    };

    sse.onerror = (err) => {
      console.warn("SSE stream disconnected, attempting to reconnect...");
      // Reconnection is handled automatically by EventSource, but we can set error state if needed
    };

    return () => {
      mounted = false;
      sse.close();
    };
  }, [refreshKey]);

  return (
    <StreamContext.Provider value={{ stations, anomalies, vehicles, kpis, loading, error, forceRefresh }}>
      {children}
    </StreamContext.Provider>
  );
}

export function useStream() {
  const context = useContext(StreamContext);
  if (!context) throw new Error("useStream must be used within StreamProvider");
  return context;
}
