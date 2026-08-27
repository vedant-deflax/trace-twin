"""Pydantic response models for the TRACE-TWIN API."""

from pydantic import BaseModel
from typing import Optional


class StationBrief(BaseModel):
    id: str
    name: str


class StationResponse(BaseModel):
    id: str
    name: str
    sequence_no: int
    has_sensors: bool
    resource_id: Optional[str] = None
    baseline: Optional[dict] = None
    status: Optional[str] = None  # 'normal' | 'warning' | 'anomaly'


class ProcessEventResponse(BaseModel):
    id: int
    vehicle_id: str
    station_id: str
    resource_id: Optional[str] = None
    entered_at: str
    exited_at: Optional[str] = None
    cycle_time_sec: Optional[float] = None
    vibration_mm_s: Optional[float] = None
    temperature_c: Optional[float] = None
    torque_nm: Optional[float] = None
    source_system: Optional[str] = None
    is_inferred: bool = False


class RootCauseResponse(BaseModel):
    cause_label: str
    probability_pct: float


class WhatIfScenarioResponse(BaseModel):
    scenario_label: str
    projected_throughput_impact: float
    projected_defect_containment: float
    is_recommended: bool = False


class AnomalyListResponse(BaseModel):
    id: int
    station: StationBrief
    detected_at: str
    status: str
    confidence_score: Optional[float] = None
    recommended_action: Optional[str] = None


class AnomalyDetailResponse(BaseModel):
    id: int
    station: StationBrief
    detected_at: str
    residuals: dict
    root_causes: list[RootCauseResponse]
    confidence_score: Optional[float] = None
    predicted_risk_pct: Optional[float] = None
    recommended_action: Optional[str] = None
    blast_radius: list[str]
    what_if: list[WhatIfScenarioResponse]
    status: str
    window_start: str
    window_end: Optional[str] = None


class VehicleDetailResponse(BaseModel):
    id: str
    model: Optional[str] = None
    line_entry_ts: str
    events: list[ProcessEventResponse]


class BlastRadiusResponse(BaseModel):
    anomaly_id: int
    vehicle_ids: list[str]
    count: int
    window_start: str
    window_end: Optional[str] = None


class ApproveRequest(BaseModel):
    action: Optional[str] = None


class TickResponse(BaseModel):
    events_generated: int
    anomalies_detected: int
    message: str

class VehicleListResponse(BaseModel):
    id: str
    model: Optional[str] = None
    current_station: Optional[str] = None
    status: str
    is_in_blast_radius: bool = False

class FactoryKPIsResponse(BaseModel):
    active_line_velocity: float
    fleet_defect_risk_pct: float
    blind_stations_inferred: int
    total_blind_stations: int
    total_units_in_buffer: int
