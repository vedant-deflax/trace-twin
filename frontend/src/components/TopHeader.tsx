"use client";

import { usePersona } from "@/lib/PersonaContext";

export function TopHeader() {
  const { persona, setPersona } = usePersona();

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-[#0a0f1a] border-b border-gray-800">
      <div className="flex items-center gap-4">
        <span className="text-sm font-semibold text-white">Persona View:</span>
        <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-800">
          <button
            onClick={() => setPersona("supervisor")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              persona === "supervisor"
                ? "bg-cyan-500 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Floor Supervisor
          </button>
          <button
            onClick={() => setPersona("manager")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              persona === "manager"
                ? "bg-purple-500 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Plant Manager
          </button>
        </div>
      </div>
      <div className="text-xs text-gray-500">
        {persona === "supervisor" 
          ? "Monitoring real-time line health and sensor inference."
          : "Analyzing systemic risk and intervention scenarios."}
      </div>
    </header>
  );
}
