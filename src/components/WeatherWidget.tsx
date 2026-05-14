import { useEffect, useRef } from 'react';

export function WeatherWidget() {
  const iframeContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background: #ffffff; overflow: hidden; display: flex; justify-content: center;">
        <div style="width: 300px; padding-top: 20px;">
          <a href="https://metar-taf.com/metar/DAUH" id="metartaf-EAEi70uD" style="font-size:18px; font-weight:500; color:#000; width:300px; height:435px; display:block; text-decoration: none; font-family: sans-serif; text-align: center;">Loading METAR Data...</a>
          <script async defer crossorigin="anonymous" src="https://metar-taf.com/embed-js/DAUH?qnh=hPa&rh=rh&target=EAEi70uD"></script>
        </div>
      </body>
    </html>
  `;

  return (
    <div className="theme-container h-full p-4 bg-white border-white flex flex-col items-center shadow-xl">
      <div className="w-full flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em]">METAR Live Feed</h3>
        <span className="text-[8px] text-blue-600 font-bold uppercase tracking-tight">DAUH / HASSI MESSAOUD</span>
      </div>
      <div className="w-full overflow-hidden flex justify-center bg-slate-50 rounded-xl p-2 border border-slate-200 flex-1 min-h-[445px]">
        <iframe
          srcDoc={iframeContent}
          style={{ width: '300px', height: '435px', border: 'none' }}
          title="Weather Widget"
          scrolling="no"
        />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <div className="w-1 h-1 rounded-full bg-blue-600 animate-pulse" />
        <p className="text-[8px] text-slate-400 font-black uppercase tracking-[0.1em]">Aviation Weather Intel</p>
      </div>
    </div>
  );
}
