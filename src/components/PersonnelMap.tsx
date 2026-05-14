import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Personnel } from '../types';
import { cn } from '../lib/utils';
import { User, MapPin, Navigation, Clock } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet when using Vite
const DefaultIcon = L.divIcon({
  html: `<div class="w-6 h-6 bg-emerald-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center animate-pulse">
           <div class="w-1.5 h-1.5 bg-white rounded-full"></div>
         </div>`,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

interface PersonnelMapProps {
  onDutyPersonnel: Personnel[];
}

function MapController({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, 13, { duration: 1.5 });
    }
  }, [center, map]);
  return null;
}

export function PersonnelMap({ onDutyPersonnel }: PersonnelMapProps) {
  const [selectedPersonnel, setSelectedPersonnel] = useState<Personnel | null>(null);
  const [flyToCoords, setFlyToCoords] = useState<[number, number] | null>(null);

  // Default view: Algeria Oil Fields area (Hassi Messaoud)
  const defaultCenter: [number, number] = [31.6730, 6.0700];

  const handleSelect = (p: Personnel) => {
    setSelectedPersonnel(p);
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!isNaN(lat) && !isNaN(lng)) {
      setFlyToCoords([lat, lng]);
    }
  };

  // Personnel with valid coordinates
  const trackablePersonnel = onDutyPersonnel.filter(p => {
    const lat = typeof p.lat === 'string' ? parseFloat(p.lat) : p.lat;
    const lng = typeof p.lng === 'string' ? parseFloat(p.lng) : p.lng;
    return typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);
  });

  return (
    <div className="flex flex-col md:flex-row h-[700px] md:h-[600px] bg-slate-950 rounded-2xl overflow-hidden border border-white/5">
      {/* Sidebar - Personnel List */}
      <div className="w-full md:w-80 flex flex-col h-64 md:h-auto border-r border-white/5 bg-black/20 shrink-0">
        <div className="p-4 border-b border-white/5">
          <h3 className="text-xs font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2">
            <Navigation size={14} /> Tracking On Duty
          </h3>
          <p className="text-[10px] text-slate-500 font-medium mt-1">Live updates from field operations</p>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {onDutyPersonnel.map((p) => {
            const isTrackable = !!(p.lat && p.lng);
            return (
              <button
                key={p.id}
                onClick={() => isTrackable && handleSelect(p)}
                disabled={!isTrackable}
                className={cn(
                  "w-full text-left p-3 rounded-xl transition-all flex items-center gap-3 border",
                  selectedPersonnel?.id === p.id 
                    ? "bg-emerald-500/10 border-emerald-500/30" 
                    : "bg-transparent border-transparent hover:bg-white/5",
                  !isTrackable && "opacity-40 cursor-not-allowed"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  isTrackable ? "bg-emerald-500/10 text-emerald-500" : "bg-slate-800 text-slate-600"
                )}>
                  <User size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-white truncate uppercase tracking-tighter">{p.fullName}</p>
                    {isTrackable && <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_5px_rgba(16,185,129,0.8)]" />}
                  </div>
                  <p className="text-[9px] text-slate-500 truncate font-medium uppercase">{p.title}</p>
                  {isTrackable && (
                    <p className="text-[8px] text-emerald-600 font-mono mt-0.5 flex items-center gap-1">
                      <MapPin size={8} /> {Number(p.lat).toFixed(4)}, {Number(p.lng).toFixed(4)}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
          {onDutyPersonnel.length === 0 && (
            <div className="p-8 text-center opacity-20">
               <User size={32} className="mx-auto mb-2 text-slate-600" />
               <p className="text-[10px] uppercase font-black">No Active Personnel</p>
            </div>
          )}
        </div>
        
        <div className="p-3 bg-white/[0.02] border-t border-white/5">
          <div className="flex items-center justify-between text-[8px] font-black text-slate-600 uppercase tracking-widest">
            <span>Active Sensors: {trackablePersonnel.length}</span>
            <span>OSM Layer v1.0</span>
          </div>
        </div>
      </div>

      {/* Map Content */}
      <div className="flex-1 relative bg-[#0a0a0c]">
        <MapContainer 
          center={defaultCenter} 
          zoom={10} 
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {trackablePersonnel.map((p) => {
            const lat = Number(p.lat);
            const lng = Number(p.lng);
            return (
              <Marker 
                key={p.id} 
                position={[lat, lng]}
                icon={DefaultIcon}
                eventHandlers={{
                  click: () => setSelectedPersonnel(p)
                }}
              >
                <Tooltip direction="top" offset={[0, -12]} opacity={1}>
                  <div className="flex items-center gap-2 px-1 py-0.5">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_4px_rgba(16,185,129,1)]" />
                    <span className="text-[10px] font-black text-slate-800 uppercase tracking-tight">{p.fullName}</span>
                  </div>
                </Tooltip>
                <Popup className="custom-popup">
                  <div className="p-1 min-w-[200px]">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                        <User size={14} />
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900 uppercase m-0 leading-none">{p.fullName}</p>
                        <p className="text-[9px] text-slate-500 font-bold uppercase m-0 mt-1">{p.title}</p>
                      </div>
                    </div>
                    <div className="bg-slate-100 rounded-lg p-2 space-y-1.5">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="font-bold text-slate-400 uppercase">Status</span>
                        <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black uppercase text-[8px]">On Duty</span>
                      </div>
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="font-bold text-slate-400 uppercase">Field Area</span>
                        <span className="text-slate-700 font-bold">{lat > 31.5 ? 'Hassi Messaoud Terminal' : 'MLN Complex'}</span>
                      </div>
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="font-bold text-slate-400 uppercase">Last Sync</span>
                        <span className="text-slate-600 flex items-center gap-1"><Clock size={10} /> Live Now</span>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          
          <MapController center={flyToCoords} />
        </MapContainer>

        {/* Floating Controls Overlay */}
        <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
           <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-1.5 rounded-xl flex flex-col items-center">
             <button title="Base Map" className="p-2 text-slate-400 hover:text-white transition-colors"><MapPin size={16} /></button>
           </div>
        </div>
      </div>
    </div>
  );
}
