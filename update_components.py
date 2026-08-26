import re

with open('frontend/src/components/DashboardComponents.tsx', 'r') as f:
    content = f.read()

# Replace StationCard definition
content = re.sub(
    r'function StationCard\(\{ station \}: \{ station: Station \}\) \{',
    r'function StationCard({ station, selected, onClick }: { station: Station; selected?: boolean; onClick?: () => void }) {',
    content
)

# Replace Link with button in StationCard
content = re.sub(
    r'<Link[^>]*href=\{`\/station\/\$\{station\.id\}`\}[^>]*className={`([^`]+)`}',
    r'<button onClick={onClick} className={`\1 ${selected ? "ring-2 ring-cyan-400 bg-gray-800" : ""}`}',
    content
)
content = re.sub(r'</Link>', r'</button>', content)

# Replace ZoneGroup definition
content = re.sub(
    r'function ZoneGroup\(\{ title, stations \}: \{ title: string; stations: Station\[\] \}\) \{',
    r'function ZoneGroup({ title, stations, selectedId, onSelect }: { title: string; stations: Station[]; selectedId?: string; onSelect?: (id: string) => void }) {',
    content
)

# Replace StationCard usage in ZoneGroup
content = re.sub(
    r'<StationCard station=\{s\} />',
    r'<StationCard station={s} selected={s.id === selectedId} onClick={() => onSelect && onSelect(s.id)} />',
    content
)

# Replace LineOverview definition
content = re.sub(
    r'function LineOverview\(\{ stations \}: \{ stations: Station\[\] \}\) \{',
    r'function LineOverview({ stations, selectedId, onSelect }: { stations: Station[]; selectedId?: string; onSelect?: (id: string) => void }) {',
    content
)

# Replace ZoneGroup usages in LineOverview
content = re.sub(
    r'<ZoneGroup title="([^"]+)" stations=\{([^}]+)\} />',
    r'<ZoneGroup title="\1" stations={\2} selectedId={selectedId} onSelect={onSelect} />',
    content
)

with open('frontend/src/components/DashboardComponents.tsx', 'w') as f:
    f.write(content)
