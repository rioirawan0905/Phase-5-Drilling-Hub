import { useEffect, useState, useMemo } from 'react';
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

  // Group personnel by coordinates
  const groupedPersonnel = useMemo(() => {
    const groups: Record<string, Personnel[]> = {};
    
    trackablePersonnel.forEach(p => {
      const latLong = `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;
      if (!groups[latLong]) groups[latLong] = [];
      groups[latLong].push(p);
    });
    
    return Object.entries(groups).map(([coords, persons]) => {
      const [lat, lng] = coords.split(',').map(Number);
      return { lat, lng, persons };
    });
  }, [trackablePersonnel]);

  return (
    <div className="relative h-[700px] md:h-[600px] bg-slate-950 rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
      {/* Vibrant Abstract Gradient Background Blobs for bokeh effect */}
      <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-indigo-500/40 rounded-full blur-[140px] pointer-events-none z-0 animate-pulse" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[65%] h-[65%] bg-emerald-500/30 rounded-full blur-[160px] pointer-events-none z-0" />
      <div className="absolute top-[25%] right-[-5%] w-[40%] h-[50%] bg-pink-500/20 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[20%] left-[10%] w-[15%] h-[25%] bg-blue-400/30 rounded-full blur-[110px] pointer-events-none z-0" />

      {/* Sidebar - Personnel List Overlay (Digital Tactical Glass) */}
      <div className="absolute left-6 top-6 bottom-6 w-64 md:w-80 z-[1000] hidden md:flex flex-col border border-white/40 bg-white/30 backdrop-blur-[60px] rounded-2xl overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.4)] ring-1 ring-white/50">
        {/* Frost Texture Overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/p6.png')]" />
        {/* Inner Glow */}
        <div className="absolute inset-0 pointer-events-none rounded-2xl border border-white/60 shadow-[inset_0_0_20px_rgba(255,255,255,0.4)]" />
        
        <div className="relative p-6 border-b border-black/5 bg-white/10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-black text-black uppercase tracking-[0.4em] flex items-center gap-2">
              <Navigation size={12} className="animate-pulse" /> Tactical Entry
            </h3>
            <span className="text-[8px] font-black text-black uppercase tracking-widest px-2 py-0.5 border border-black/20 rounded-md bg-black/5">LIVE</span>
          </div>
          <p className="text-[14px] text-black font-black uppercase tracking-tight leading-tight">Real Time On Duty Personnel Location</p>
        </div>
        
        <div className="relative flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          {onDutyPersonnel.map((p) => {
            const isTrackable = !!(p.lat && p.lng);
            return (
              <button
                key={p.id}
                onClick={() => isTrackable && handleSelect(p)}
                disabled={!isTrackable}
                className={cn(
                  "relative w-full text-left p-4 rounded-xl transition-all flex items-center gap-4 border group overflow-hidden",
                  selectedPersonnel?.id === p.id 
                    ? "bg-white/50 border-black/10 shadow-[0_8px_16px_rgba(0,0,0,0.1)]" 
                    : "bg-white/10 border-white/20 hover:bg-white/30 hover:border-white/40",
                  !isTrackable && "opacity-20 cursor-not-allowed"
                )}
              >
                {selectedPersonnel?.id === p.id && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
                )}
                
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 shadow-sm border transition-all duration-300 group-hover:scale-110",
                  isTrackable 
                    ? "bg-black/5 text-black border-black/5" 
                    : "bg-black/5 text-black/20 border-black/5"
                )}>
                  <User size={20} className={cn(selectedPersonnel?.id === p.id && "animate-pulse")} />
                </div>
                
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 leading-none">
                    <p className="text-[13px] font-black text-black truncate uppercase tracking-tight">{p.fullName}</p>
                    {isTrackable && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-40"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-black"></span>
                      </span>
                    )}
                  </div>
                  <p className="text-[9px] text-black font-bold uppercase tracking-widest mt-1.5 opacity-60 italic">{p.title}</p>
                </div>
              </button>
            );
          })}
          {onDutyPersonnel.length === 0 && (
            <div className="p-12 text-center opacity-40">
               <User size={40} className="mx-auto mb-3 text-black" />
               <p className="text-[10px] uppercase font-black tracking-[0.2em] text-black">Vacuum State: Offline</p>
            </div>
          )}
        </div>
        
        <div className="relative p-5 bg-white/20 border-t border-black/5 backdrop-blur-xl">
          <div className="flex items-center justify-between text-[9px] font-black text-black uppercase tracking-[0.3em]">
            <div className="flex items-center gap-2">
               <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
               <span className="opacity-70">ACTIVE UNITS: {trackablePersonnel.length}</span>
            </div>
            <span className="opacity-30">OS x64</span>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Toggle / Status - Tactical Redesign */}
      <div className="md:hidden absolute top-6 left-6 right-6 z-[1000] bg-white/10 backdrop-blur-3xl border border-white/30 rounded-2xl p-4 flex items-center justify-between shadow-2xl ring-1 ring-inset ring-white/20">
         <div className="flex items-center gap-4">
           <div className="p-2 bg-emerald-500/20 rounded-lg ring-1 ring-emerald-500/30">
             <Navigation size={16} className="text-emerald-400 animate-pulse" />
           </div>
           <div>
             <span className="text-[11px] font-black text-white uppercase tracking-[0.2em] drop-shadow-md">Command Feed</span>
             <p className="text-[8px] text-white/50 font-black uppercase tracking-widest mt-1">{trackablePersonnel.length} DEPLOYED</p>
           </div>
         </div>
      </div>

      {/* Map Content */}
      <div className="absolute inset-0 bg-[#0a0a0c]">
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
          
          {groupedPersonnel.map((group, idx) => {
            return (
              <Marker 
                key={`${group.lat}-${group.lng}-${idx}`} 
                position={[group.lat, group.lng]}
                icon={DefaultIcon}
              >
                <Tooltip direction="top" offset={[0, -12]} opacity={1} permanent={false}>
                  <div className="flex flex-col gap-1 min-w-[120px] p-1">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-1 mb-1">
                      <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Unit Group</span>
                      <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1 rounded transition-all">{group.persons.length} PAX</span>
                    </div>
                    {group.persons.map(p => (
                      <div key={p.id} className="flex items-center gap-2 bg-slate-50/50 rounded p-1">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        <span className="text-[10px] font-bold text-slate-800 uppercase truncate max-w-[100px]">{p.fullName}</span>
                      </div>
                    ))}
                  </div>
                </Tooltip>
                
                <Popup className="custom-popup">
                  <div className="p-1 min-w-[220px] max-h-[300px] overflow-y-auto custom-scrollbar">
                    <h4 className="text-[10px] font-extrabold text-slate-900 uppercase tracking-widest mb-3 border-b pb-2 flex items-center justify-between">
                      Personnel at Location
                      <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-[9px]">{group.persons.length}</span>
                    </h4>
                    
                    <div className="space-y-3">
                      {group.persons.map(p => (
                        <div key={p.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center text-white shrink-0">
                              <User size={12} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] font-black text-slate-900 uppercase m-0 leading-none truncate">{p.fullName}</p>
                              <p className="text-[9px] text-slate-400 font-bold uppercase m-0 mt-1 truncate">{p.title}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[9px] mt-2 pt-2 border-t border-slate-200/50">
                            <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black uppercase text-[8px]">On Duty</span>
                            <span className="text-slate-500 font-mono text-[8px]">{Number(p.lat).toFixed(3)}, {Number(p.lng).toFixed(3)}</span>
                          </div>
                        </div>
                      ))}
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
