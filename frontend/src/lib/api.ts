const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ---- Types matching backend Pydantic models ----

export interface Station {
  id: string;
  name: string;
  sequence_no: number;
  has_sensors: boolean;
  resource_id: string | null;
  baseline: { expected_cycle_time_sec: number; expected_vibration_mm_s: number; expected_temperature_c: number } | null;
  status: "normal" | "warning" | "anomaly" | null;
  actual_power_kw?: number;
  min_achievable_power_kw?: number;
  avoidable_waste_kw?: number;
  avoidable_energy_cost_hourly?: number;
  optimal_plant_temp_c?: number;
}


export interface ProcessEvent {
  id: number;
  vehicle_id: string;
  station_id: string;
  resource_id: string | null;
  entered_at: string;
  exited_at: string | null;
  cycle_time_sec: number | null;
  vibration_mm_s: number | null;
  temperature_c: number | null;
  torque_nm: number | null;
  source_system: string | null;
  is_inferred: boolean;
  sequence_no?: number;
}

export interface RootCause {
  cause_label: string;
  probability_pct: number;
}

export interface WhatIfScenario {
  scenario_label: string;
  projected_throughput_impact: number;
  projected_defect_containment: number;
  is_recommended: boolean;
}

export interface AnomalyListItem {
  id: number;
  station: { id: string; name: string; sequence_no?: number; has_sensors?: boolean; resource_id?: string; baseline?: any; status?: string };
  detected_at: string;
  status: string;
  confidence_score: number | null;
  recommended_action: string | null;
  root_causes?: RootCause[];
  blast_radius?: string[];
  residual_cycle_time?: number | null;
  residual_vibration?: number | null;
  residual_temperature?: number | null;
  residuals?: { cycle_time_sec?: number; vibration_mm_s?: number; temperature_c?: number };
  what_if?: WhatIfScenario[];
}

export interface AnomalyDetail {
  id: number;
  station: { id: string; name: string };
  detected_at: string;
  residuals: { cycle_time_sec: number; vibration_mm_s: number; temperature_c: number };
  root_causes: RootCause[];
  confidence_score: number | null;
  predicted_risk_pct: number | null;
  recommended_action: string | null;
  blast_radius: string[];
  what_if: WhatIfScenario[];
  status: string;
  window_start: string;
  window_end: string | null;
}

export interface VehicleDetail {
  id: string;
  model: string | null;
  line_entry_ts: string;
  events: ProcessEvent[];
}

export interface BlastRadiusData {
  anomaly_id: number;
  vehicle_ids: string[];
  count: number;
  window_start: string;
  window_end: string | null;
}

export interface VehicleListItem {
  id: string;
  model: string | null;
  current_station: string | null;
  status: string;
  is_in_blast_radius: boolean;
  sequence_no?: number;
  completed?: boolean;
  station_count?: number;
  defect_label?: string;
  defect_risk_pct?: number;
  predicted_defect_probability?: number;
  model_feature_importances?: { feature: string; feature_label: string; importance_pct: number; observed_value: number }[];
}

export interface FactoryKPIs {
  active_line_velocity: number;
  fleet_defect_risk_pct: number;
  blind_stations_inferred: number;
  total_blind_stations: number;
  total_units_in_buffer: number;
  total_line_power_kw?: number;
  optimal_line_power_kw?: number;
  avoidable_waste_kw?: number;
  avoidable_energy_cost_hourly?: number;
  avoidable_energy_cost_daily?: number;
  top_energy_drain_stations?: {
    station_id: string;
    name: string;
    sequence_no: number;
    actual_power_kw: number;
    min_achievable_power_kw: number;
    avoidable_waste_kw: number;
    hourly_waste_cost: number;
    recommended_action: string;
  }[];
}

export interface DiagnosticData {
  vehicle_id: string;
  station_seq: number;
  station_id: string;
  station_name: string;
  status: "CRITICAL" | "WARNING" | "HEALTHY" | string;
  severity_color: "red" | "amber" | "green" | string;
  confidence_score: number;
  key_contributors: string[];
  retrieved_context: string[];
  primary_root_cause: string;
  causal_mechanism: string;
  containment_action: string;
  actual_power_kw?: number;
  min_achievable_power_kw?: number;
  avoidable_waste_kw?: number;
  avoidable_energy_cost_hourly?: number;
  optimal_plant_temp_c?: number;
  telemetry_summary: {
    cycle_time_sec: number;
    vibration_mm_s: number;
    temperature_c: number;
    torque_nm: number;
    actual_power_kw?: number;
    min_achievable_power_kw?: number;
    avoidable_waste_kw?: number;
    avoidable_energy_cost_hourly?: number;
    optimal_plant_temp_c?: number;
    delta_torque: number;
    delta_vibration: number;
    delta_temperature: number;
    delta_cycle_time: number;
    z_torque: number;
    z_vibration: number;
    z_temperature: number;
    z_cycle_time: number;
    is_inferred: boolean;
  };
}

