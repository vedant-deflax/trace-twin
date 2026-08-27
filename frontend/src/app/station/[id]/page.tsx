"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStream } from "@/context/StreamContext";
import { fetchAPI, AnomalyDetail, ProcessEvent } from "@/lib/api";
import { MemoResidualCard, MemoBlastRadiusPanel, MemoResidualChart, MemoWhatIfPanel } from "@/components/DashboardComponents";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { usePersona } from "@/lib/PersonaContext";
import Link from "next/link";

export default function StationTelemetryPage() {
  const { id } = useParams() as { id: string };
  const { stations, anomalies, forceRefresh } = useStream();
  const { persona } = usePersona();
  const router = useRouter();

  const [anomalyDetail, setAnomalyDetail] = useState<AnomalyDetail | null>(null);
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const station = stations.find(s => s.id === id);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const eventsData = await fetchAPI<ProcessEvent[]>(`/stations/${id}/events?limit=30`);
        setEvents(eventsData);
        
        const openAnom = anomalies.find(a => a.station.id === id);
        if (openAnom) {
          const detail = await fetchAPI<AnomalyDetail>(`/anomalies/${openAnom.id}`);
          setAnomalyDetail(detail);
        } else {
          setAnomalyDetail(null);
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }
    load();
    
    const interval = setInterval(() => {
      load();
    }, 5000);
    return () => clearInterval(interval);
  }, [id, anomalies]);

  if (!station && !loading) {
    return <div className="p-6 text-white">Station not found</div>;
  }

  const isSupervisor = persona === "supervisor";
  const baseline = station?.baseline?.expected_cycle_time_sec || 52;

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/" className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Line Overview
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">Station {station?.sequence_no}: {station?.name}</h1>
          <p className="text-xs text-gray-500 mt-0.5">Live Telemetry & Analytics</p>
        </div>
      </div>

      {!anomalyDetail && !loading && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-4">
          <h2 className="text-white font-bold mb-4">Live Telemetry Stream</h2>
          <MemoResidualChart events={events} baseline={baseline} />
        </div>
      )}

      {anomalyDetail && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Left column */}
          <div className={`space-y-4 ${isSupervisor ? "order-1" : "order-2 xl:order-1"}`}>
            <MemoResidualCard anomaly={anomalyDetail} highlight={isSupervisor} />
            {isSupervisor && (
              <MemoBlastRadiusPanel
                vehicles={anomalyDetail.blast_radius}
                windowStart={anomalyDetail.window_start}
                windowEnd={anomalyDetail.window_end}
                highlight={true}
              />
            )}
            <MemoResidualChart events={events} baseline={baseline} />
          </div>

          {/* Right column */}
          <div className={`space-y-4 ${isSupervisor ? "order-2" : "order-1 xl:order-2"}`}>
            {!isSupervisor && (
              <MemoWhatIfPanel
                scenarios={anomalyDetail.what_if}
                anomalyId={anomalyDetail.id}
                onApprove={() => forceRefresh()}
                highlight={true}
              />
            )}
            {isSupervisor ? (
              <MemoWhatIfPanel
                scenarios={anomalyDetail.what_if}
                anomalyId={anomalyDetail.id}
                onApprove={() => forceRefresh()}
                highlight={false}
              />
            ) : (
              <MemoBlastRadiusPanel
                vehicles={anomalyDetail.blast_radius}
                windowStart={anomalyDetail.window_start}
                windowEnd={anomalyDetail.window_end}
                highlight={false}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
