import { useEffect, useRef } from 'react';

export function WeatherWidget() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The script provided by metar-taf.com
    const scriptId = 'metartaf-script';
    
    // Cleanup any existing script to force re-execution
    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement('script');
    script.id = scriptId;
    // Exactly as provided by user: target=EAEi70uD
    script.src = 'https://metar-taf.com/embed-js/DAUH?qnh=hPa&rh=rh&target=EAEi70uD';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    
    // Appending to the container instead of body to ensure proximity
    if (containerRef.current) {
      containerRef.current.appendChild(script);
    }

    return () => {
      const s = document.getElementById(scriptId);
      if (s) s.remove();
    };
  }, []);

  return (
    <div className="theme-container p-4 bg-blue-950/20 border-blue-500/20 flex flex-col items-center">
      <div className="w-full flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">METAR Live Feed</h3>
        <span className="text-[8px] text-blue-500 font-bold uppercase tracking-tight">DAUH / HASSI MESSAOUD</span>
      </div>
      <div ref={containerRef} className="w-full overflow-hidden flex justify-center bg-black/40 rounded-xl p-2 border border-white/5 min-h-[445px]">
        <a 
          href="https://metar-taf.com/metar/DAUH" 
          id="metartaf-EAEi70uD" 
          style={{
            fontSize: '18px', 
            fontWeight: '500', 
            color: '#fff', 
            width: '300px', 
            height: '435px', 
            display: 'block',
            textDecoration: 'none',
            textAlign: 'center',
            paddingTop: '20px'
          }}
        >
          METAR Hassi Messaoud-Oued Irara Krim Belkacem Airport
        </a>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
        <p className="text-[8px] text-slate-500 font-black uppercase tracking-[0.1em]">Aviation Weather Intel</p>
      </div>
    </div>
  );
}
