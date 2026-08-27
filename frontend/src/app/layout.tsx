import type { Metadata } from "next";
import { PersonaProvider } from "@/lib/PersonaContext";
import { StreamProvider } from "@/context/StreamContext";
import { TopHeader } from "@/components/TopHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRACE-TWIN | Digital Twin Dashboard",
  description: "Causal, Context-Aware Risk Intelligence for Vehicle Assembly Lines",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full flex font-sans">
        <PersonaProvider>
          <StreamProvider>
            {/* Sidebar */}
            <aside className="w-56 shrink-0 bg-[#0a0f1a] border-r border-gray-800 flex flex-col z-20">
              <div className="px-4 pt-5 pb-4 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <span className="text-cyan-400 text-sm font-bold">TT</span>
                  </div>
                  <div>
                    <h1 className="text-sm font-bold text-white tracking-wide">TRACE-TWIN</h1>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">Digital Twin</p>
                  </div>
                </div>
              </div>
              <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
                <a href="/" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-300 hover:text-white hover:bg-white/5 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  Line Overview
                </a>
                <a href="/vehicles" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-300 hover:text-white hover:bg-white/5 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  Digital Thread
                </a>
                <a href="/what-if" className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-300 hover:text-white hover:bg-white/5 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                  What-If Simulator
                </a>
              </nav>
              <div className="px-4 py-3 border-t border-gray-800 text-[10px] text-gray-600">
                Round 2 • DigitalTwin.ai
              </div>
            </aside>

            {/* Main content wrapper */}
            <div className="flex-1 flex flex-col min-w-0 bg-[#030712]">
              <TopHeader />
              <main className="flex-1 overflow-y-auto">
                {children}
              </main>
            </div>
          </StreamProvider>
        </PersonaProvider>
      </body>
    </html>
  );
}
