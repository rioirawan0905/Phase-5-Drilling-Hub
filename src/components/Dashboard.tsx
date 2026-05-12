import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { FlightRequest, Personnel, Scheduling, HubEvent } from '../types';
import { PieChart, Pie, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, LabelList } from 'recharts';
import { Users, Plane, Activity, CheckCircle2, AlertCircle, Clock, Filter, Calendar, Briefcase, LayoutGrid, ArrowRight, ArrowLeft, Download, Info, Globe, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog, Wind, Tag, Palmtree, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from '../lib/utils';
import * as XLSX from 'xlsx';

interface DashboardProps {
  isGuest?: boolean;
}

// Robust date parser for various formats (string, Firestore Timestamp, etc)
const toDate = (d: any) => {
  if (!d) return null;
  if (typeof d === 'string') return new Date(d);
  if (d.toDate && typeof d.toDate === 'function') return d.toDate();
  if (d.seconds) return new Date(d.seconds * 1000);
  return new Date(d);
};

export function Dashboard({ isGuest }: DashboardProps) {
  const [stats, setStats] = useState({
    totalPersonnel: 0,
    onDutyPercent: 0,
    pendingFlights: 0,
    completedFlights: 0,
    onDutyCount: 0
  });

  const [recentFlights, setRecentFlights] = useState<FlightRequest[]>([]);
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [routeData, setRouteData] = useState<any[]>([]);
  const [statusData, setStatusData] = useState<any[]>([]);
  const [allFlights, setAllFlights] = useState<FlightRequest[]>([]);
  
  // Labor Stats State
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [schedules, setSchedules] = useState<Scheduling[]>([]);
  
  // Filters
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>([]); // YYYY-MM
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [selectedPersonnel, setSelectedPersonnel] = useState<string>('ALL');
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  
  // Summary Table Filters
  const [summaryGroup, setSummaryGroup] = useState<string>('ALL');
  const [summaryPersonnel, setSummaryPersonnel] = useState<string>('ALL');
  const [summaryMonth, setSummaryMonth] = useState<string>('ALL');
  const [summaryStatus, setSummaryStatus] = useState<string>('ALL');

  // Helper for weather icons
  const getWeatherIcon = (desc: string = '') => {
    const d = desc.toLowerCase();
    if (d.includes('sun') || d.includes('clear')) return <Sun size={12} className="text-amber-400" />;
    if (d.includes('lightning') || d.includes('thunder')) return <CloudLightning size={12} className="text-yellow-400" />;
    if (d.includes('rain') || d.includes('shower')) return <CloudRain size={12} className="text-blue-400" />;
    if (d.includes('drizzle')) return <CloudDrizzle size={12} className="text-blue-300" />;
    if (d.includes('snow')) return <CloudSnow size={12} className="text-white" />;
    if (d.includes('fog') || d.includes('mist')) return <CloudFog size={12} className="text-slate-400" />;
    return <Cloud size={12} className="text-slate-300" />;
  };

  const getAQIInfo = (aqi: number) => {
    if (!aqi) return { label: 'N/A', color: 'text-slate-500' };
    if (aqi <= 50) return { label: 'Good', color: 'text-emerald-400' };
    if (aqi <= 100) return { label: 'Moderate', color: 'text-yellow-400' };
    if (aqi <= 150) return { label: 'Unhealthy SG', color: 'text-orange-400' };
    if (aqi <= 200) return { label: 'Unhealthy', color: 'text-rose-400' };
    if (aqi <= 300) return { label: 'Very Unhealthy', color: 'text-purple-400' };
    return { label: 'Hazardous', color: 'text-rose-600' };
  };

  // World Clocks & Weather State
  const [times, setTimes] = useState({ jakarta: '', algiers: '' });
  const [weather, setWeather] = useState<any>(null);

  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setTimes({
        jakarta: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        algiers: now.toLocaleTimeString('en-GB', { timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      });
    };

    updateClocks();
    const timer = setInterval(updateClocks, 1000);

    // Dynamic Weather & AQI Fetch
    const fetchEnvironmentData = async () => {
      try {
        const [jkRes, alRes] = await Promise.all([
          fetch('https://wttr.in/Jakarta?format=j1'),
          fetch('https://wttr.in/Algiers?format=j1')
        ]);
        const jkData = await jkRes.json();
        const alData = await alRes.json();
        
        // AQI Data (WAQI)
        // Note: Using demo token. In production, use VITE_WAQI_TOKEN
        let jkAQI = 0;
        let alAQI = 0;
        try {
          const [jkAqiRes, alAqiRes] = await Promise.all([
            fetch('https://api.waqi.info/feed/jakarta/?token=demo'),
            fetch('https://api.waqi.info/feed/algiers/?token=demo')
          ]);
          const jkAQIData = await jkAqiRes.json();
          const alAQIData = await alAqiRes.json();
          if (jkAQIData.status === 'ok') jkAQI = jkAQIData.data.aqi;
          if (alAQIData.status === 'ok') alAQI = alAQIData.data.aqi;
        } catch (aqiError) {
          console.error("AQI fetch failed", aqiError);
        }

        setWeather({
          jakarta: { 
            temp: jkData.current_condition[0].temp_C, 
            desc: jkData.current_condition[0].weatherDesc[0].value,
            aqi: jkAQI
          },
          algiers: { 
            temp: alData.current_condition[0].temp_C, 
            desc: alData.current_condition[0].weatherDesc[0].value,
            aqi: alAQI
          }
        });
      } catch (e) {
        console.error("Weather fetch failed", e);
      }
    };
    fetchEnvironmentData();
    const weatherTimer = setInterval(fetchEnvironmentData, 1800000); // Update every 30 mins

    return () => {
      clearInterval(timer);
      clearInterval(weatherTimer);
    };
  }, []);

  // Helper for status resolution used in both stats and rendering
  const getEffectiveStatus = (status: string, requestedDate?: string | null) => {
    if (status === 'Received') return "Received";
    
    let isUrgent = status === 'Need Action';
    if (requestedDate) {
      const flightDate = new Date(requestedDate);
      const today = new Date();
      const diffTime = flightDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 14) isUrgent = true;
    }

    if (isUrgent) return "Need Action";
    if (status === 'Not Requested') return "Pending";
    return status || "Requested";
  };

  useEffect(() => {
    const personnelUnsub = onSnapshot(collection(db, 'personnel'), (snap) => {
      const pData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Personnel));
      setPersonnel(pData);
      setStats(prev => ({ ...prev, totalPersonnel: snap.size }));
    });

    const schedulesUnsub = onSnapshot(collection(db, 'schedules'), (snap) => {
      const sData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scheduling));
      setSchedules(sData);
      
      const now = new Date();
      now.setHours(0,0,0,0);
      const onDuty = sData.filter(s => {
        const start = toDate(s.startDate);
        const end = toDate(s.endDate);
        if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return false;
        
        const startTime = new Date(start).setHours(0,0,0,0);
        const endTime = new Date(end).setHours(0,0,0,0);
        const status = (s.status || '').toString().toUpperCase();
        return status === 'ON_DUTY' && now.getTime() >= startTime && now.getTime() <= endTime;
      }).length;

      setStats(prev => ({ 
        ...prev, 
        onDutyCount: onDuty,
        onDutyPercent: prev.totalPersonnel ? Math.round((onDuty / prev.totalPersonnel) * 100) : 0 
      }));
    });

    const flightsUnsub = onSnapshot(collection(db, 'flightRequests'), (snap) => {
      const flights = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FlightRequest));
      setAllFlights(flights);
      
      let pendingCount = 0;
      let completedCount = 0;

      const statCounts: Record<string, number> = {
        'Requested': 0,
        'Received': 0,
        'Pending': 0,
        'Need Action': 0
      };

      flights.forEach(f => {
        if (f.requestedDateDZtoID) {
          const eff = getEffectiveStatus(f.statusDZtoID || 'Requested', f.requestedDateDZtoID);
          if (eff === 'Received') completedCount++;
          if (eff === 'Requested' || eff === 'Need Action') pendingCount++;
          statCounts[eff]++;
        }
        if (f.requestedDateIDtoDZ) {
          const eff = getEffectiveStatus(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ);
          if (eff === 'Received') completedCount++;
          if (eff === 'Requested' || eff === 'Need Action') pendingCount++;
          statCounts[eff]++;
        }
      });

      setStats(prev => ({ 
        ...prev, 
        pendingFlights: pendingCount, 
        completedFlights: completedCount 
      }));

      setRecentFlights(flights.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      }).slice(0, 10));

      const toIndo = flights.filter(f => f.requestedDateDZtoID).length;
      const toAlgeria = flights.filter(f => f.requestedDateIDtoDZ).length;
      setRouteData([
        { name: 'To Algeria', value: toAlgeria },
        { name: 'To Indonesia', value: toIndo }
      ]);

      setStatusData(Object.entries(statCounts)
        .filter(([_, value]) => value > 0)
        .map(([name, value]) => ({ name, value })));
    });

    const eventsUnsub = onSnapshot(collection(db, 'events'), (snap) => {
      setEvents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HubEvent)));
    });

    return () => {
      personnelUnsub();
      schedulesUnsub();
      flightsUnsub();
      eventsUnsub();
    };
  }, []); // Fix: Empty dependency array as listeners are live and don't need re-subscription on stat change

  // Derived Labor Data
  const getStatusLabel = (status: string, requestedDate?: string | null) => {
    return getEffectiveStatus(status, requestedDate);
  };

  const getStatusStyle = (status: string, requestedDate?: string | null) => {
    if (status === 'Received') return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    
    let isUrgent = status === 'Need Action';
    if (requestedDate) {
      const flightDate = new Date(requestedDate);
      const today = new Date();
      const diffTime = flightDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 14) isUrgent = true;
    }

    if (isUrgent) return "text-rose-500 bg-rose-500/10 border-rose-500/20 animate-pulse font-bold";

    if (status === 'Not Requested') return "text-slate-500 bg-slate-500/5 border-white/5";
    return "text-blue-400 bg-blue-500/5 border-blue-500/10";
  };

  const formatPeriod = (period: string) => {
    if (period === 'ALL') return 'ALL PERIODS';
    const [year, month] = period.split('-');
    const mNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return `${mNames[parseInt(month) - 1]}-${year}`;
  };

  const togglePeriod = (period: string) => {
    if (period === 'ALL') {
      setSelectedPeriods([]);
      return;
    }
    setSelectedPeriods(prev => 
      prev.includes(period) ? prev.filter(p => p !== period) : [...prev, period]
    );
  };

  // --- NEW LABOR ANALYTICS ENGINE ---
  const laborAnalytics = useMemo(() => {
    // 1. Filter personnel by current active filters
    const filteredPersonnel = personnel.filter(p => {
      const matchesGroup = selectedGroup === 'ALL' || p.rosterGroup === selectedGroup;
      const matchesPerson = selectedPersonnel === 'ALL' || p.id === selectedPersonnel;
      return matchesGroup && matchesPerson;
    });

    const filteredPersonnelIds = new Set(filteredPersonnel.map(p => p.id));

    // 2. Filter schedules: must be ON_DUTY, belong to filtered personnel, and match selected period
    let targetSchedules = schedules.filter(s => {
      const status = (s.status || '').toString().toUpperCase();
      const isOnDuty = status === 'ON_DUTY' || status === 'ON-DUTY';
      return isOnDuty && filteredPersonnelIds.has(s.personnelId);
    });

    // 3. Filter by period if any selected
    if (selectedPeriods.length > 0) {
      targetSchedules = targetSchedules.filter(s => {
        const start = toDate(s.startDate);
        const end = toDate(s.endDate);
        if (!start || !end || isNaN(start.getTime())) return false;
        
        const sMonth = start.toISOString().substring(0, 7);
        const eMonth = end.toISOString().substring(0, 7);
        
        // Match if any selected month is within schedule range
        return selectedPeriods.some(p => p >= sMonth && p <= eMonth);
      });
    }

    // 4. Aggregate hours
    const hoursPerPerson: Record<string, number> = {};
    let totalHoursCount = 0;

    targetSchedules.forEach(s => {
      const start = toDate(s.startDate);
      const end = toDate(s.endDate);
      if (!start || !end) return;

      // Calculate days (inclusive)
      const d1 = new Date(start).setHours(0,0,0,0);
      const d2 = new Date(end).setHours(0,0,0,0);
      const diffDays = Math.floor(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
      const hours = diffDays * 12;

      hoursPerPerson[s.personnelId] = (hoursPerPerson[s.personnelId] || 0) + hours;
      totalHoursCount += hours;
    });

    // 5. Construct chart data
    const chartData = filteredPersonnel
      .map(p => ({
        id: p.id,
        name: p.fullName || 'Unknown',
        hours: hoursPerPerson[p.id] || 0,
        group: p.rosterGroup || 'A'
      }))
      .filter(item => item.hours > 0)
      .sort((a, b) => b.hours - a.hours);

    return { totalHours: totalHoursCount, chartData };
  }, [schedules, personnel, selectedPersonnel, selectedGroup, selectedPeriods]);

  const filteredSummaryFlights = useMemo(() => {
    return allFlights.filter(f => {
      const p = personnel.find(person => person.id === f.personnelId);
      if (!p) return false;
      
      if (summaryGroup !== 'ALL' && p.rosterGroup !== summaryGroup) return false;
      if (summaryPersonnel !== 'ALL' && p.id !== summaryPersonnel) return false;
      if (summaryMonth !== 'ALL') {
        const d1 = f.requestedDateDZtoID?.substring(0, 7);
        const d2 = f.requestedDateIDtoDZ?.substring(0, 7);
        if (d1 !== summaryMonth && d2 !== summaryMonth) return false;
      }
      if (summaryStatus !== 'ALL') {
        const s1 = getEffectiveStatus(f.statusDZtoID || 'Requested', f.requestedDateDZtoID);
        const s2 = getEffectiveStatus(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ);
        if (s1 !== summaryStatus && s2 !== summaryStatus) return false;
      }
      return true;
    }).sort((a, b) => {
      const getEarliest = (f: FlightRequest) => {
        const dates = [f.requestedDateDZtoID, f.requestedDateIDtoDZ]
          .filter(Boolean)
          .map(d => new Date(d!).getTime());
        return dates.length > 0 ? Math.min(...dates) : Infinity;
      };
      return getEarliest(a) - getEarliest(b);
    });
  }, [allFlights, personnel, summaryGroup, summaryPersonnel, summaryMonth, summaryStatus]);

  const groupColorMap: Record<string, string> = {
    'A': '#3b82f6',
    'B': '#10b981',
    'C': '#f59e0b',
    'D': '#a855f7',
    'E': '#f43f5e',
    'Group A': '#3b82f6',
    'Group B': '#10b981',
    'Group C': '#f59e0b',
    'Group D': '#a855f7',
    'Group E': '#f43f5e',
  };

  const statusColorMap: Record<string, string> = {
    'Received': '#10b981',
    'Requested': '#3b82f6',
    'Need Action': '#ef4444',
    'Pending': '#64748b',
  };

  const uniqueGroups = useMemo(() => [...new Set(personnel.map(p => p.rosterGroup).filter(Boolean))].sort(), [personnel]);
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    schedules.forEach(s => {
      const start = toDate(s.startDate);
      const end = toDate(s.endDate);
      if (start && !isNaN(start.getTime())) months.add(start.toISOString().substring(0, 7));
      if (end && !isNaN(end.getTime())) months.add(end.toISOString().substring(0, 7));
    });
    return Array.from(months).sort().reverse();
  }, [schedules]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  const exportToExcel = () => {
    const data = allFlights.map(f => {
      const person = personnel.find(p => p.id === f.personnelId);
      return {
        'Personnel Name': person?.fullName || 'Unknown',
        'Group': person?.rosterGroup || 'N/A',
        'Duty Start': formatDate(f.startDate),
        'Duty End': formatDate(f.endDate),
        'DZ -> ID Date': formatDate(f.requestedDateDZtoID),
        'DZ -> ID Status': f.statusDZtoID || 'N/A',
        'ID -> DZ Date': formatDate(f.requestedDateIDtoDZ),
        'ID -> DZ Status': f.statusIDtoDZ || 'N/A',
        'Requested At': f.createdAt ? formatDate(new Date(f.createdAt.seconds * 1000)) : 'N/A'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Flight Requests");
    XLSX.writeFile(workbook, `Flight_Requests_Summary_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const upcomingEvents = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return events
      .filter(e => e.endDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [events]);

  const pastEvents = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return events
      .filter(e => e.endDate < today)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .slice(0, 5);
  }, [events]);

  const getEventIcon = (type: HubEvent['type'], size = 12) => {
    switch(type) {
      case 'meeting': return <Clock size={size} className="text-amber-400" />;
      case 'walkthrough': return <Users size={size} className="text-purple-400" />;
      case 'holiday': return <Palmtree size={size} className="text-emerald-400" />;
      default: return <Info size={size} className="text-blue-400" />;
    }
  };

  const getDaysUntil = (dateStr: string) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const flightDate = new Date(dateStr);
    flightDate.setHours(0,0,0,0);
    const diffTime = flightDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <div className="space-y-6 min-h-screen pb-12">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: 'Personnel', val: stats.totalPersonnel, sub: `+${stats.onDutyCount} On-Site`, color: 'text-white' },
          { label: 'Total Hours', val: laborAnalytics.totalHours.toLocaleString(), sub: 'Est. Cumulative', color: 'text-blue-400' },
          { label: 'Fulfillment', val: stats.completedFlights, sub: 'Received Tickets', color: 'text-emerald-500' },
          { 
            label: 'On Duty', 
            val: `${stats.onDutyPercent}%`, 
            sub: 'Duty Utilization', 
            color: 'text-orange-400',
            extra: (
              <div className="group relative inline-block ml-1">
                <Info size={12} className="text-slate-600 cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-[#16161a] border border-white/10 rounded text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none shadow-2xl">
                  Percentage of total personnel currently on-site and on active duty.
                </div>
              </div>
            )
          }
        ].map((item, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
            key={item.label} className="theme-card p-4 md:p-7"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] md:text-[11px] text-slate-500 uppercase tracking-widest truncate font-bold">{item.label}</p>
              {item.extra}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 md:gap-3">
              <span className={cn("text-xl md:text-3xl font-light", item.color)}>{item.val}</span>
              <span className="text-[9px] md:text-[11px] text-slate-500 leading-none truncate">{item.sub}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar: Global Intel & Events */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          {/* Global Operations Card */}
          <div className="theme-container bg-gradient-to-br from-blue-900/10 to-transparent border-blue-500/10 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="text-blue-500" size={12} />
              <h3 className="text-[9px] font-black uppercase tracking-widest text-white">Ops Intelligence</h3>
            </div>
            <div className="space-y-2">
              {[
                { id: 'JKT', city: 'Jakarta, ID', time: times.jakarta, weather: weather?.jakarta, color: 'emerald' },
                { id: 'ALG', city: 'Algiers, DZ', time: times.algiers, weather: weather?.algiers, color: 'blue' }
              ].map(location => (
                <div key={location.id} className="flex items-center justify-between p-2 rounded bg-black/40 border border-white/5 group hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-6 h-6 rounded flex items-center justify-center font-bold text-[8px]", `bg-${location.color}-500/10 text-${location.color}-500`)}>
                      {location.id}
                    </div>
                    <div>
                      <p className="text-[12px] font-mono font-black text-white leading-tight">{location.time}</p>
                      <p className="text-[7px] text-slate-600 font-bold uppercase">{location.city}</p>
                    </div>
                  </div>
                  {location.weather && (
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {getWeatherIcon(location.weather.desc)}
                        <span className="text-[10px] font-mono font-bold text-slate-300">{location.weather.temp}°C</span>
                      </div>
                      <span className={cn("text-[7px] font-black uppercase", getAQIInfo(location.weather.aqi).color)}>AQI {location.weather.aqi || '--'}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Compact Hub Events */}
          <div className="theme-container p-4 bg-emerald-900/5 border-emerald-500/10 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4 shrink-0">
               <div className="flex items-center gap-2">
                 <Tag className="text-emerald-500" size={14} />
                 <h3 className="text-[11px] font-black uppercase tracking-widest text-white">Hub Events</h3>
               </div>
               <span className="text-[9px] font-mono text-emerald-500/50 uppercase">Active</span>
          </div>
            
          <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1 max-h-[250px]">
              {upcomingEvents.length > 0 ? (
                upcomingEvents.map(ev => (
                  <div key={ev.id} className="p-2.5 rounded-lg bg-black/40 border border-white/5 group hover:border-emerald-500/30 transition-all">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {getEventIcon(ev.type, 10)}
                        <span className="text-[10px] font-bold text-slate-200 uppercase truncate" title={ev.title}>{ev.title}</span>
                      </div>
                      <span className="text-[8px] font-mono text-slate-500 uppercase bg-white/5 px-1.5 rounded shrink-0">{ev.type}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Globe size={10} className="text-slate-600" />
                        <span className="text-[9px] font-bold uppercase tracking-tight">{ev.location || 'MLN'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-[9px] text-slate-400 font-mono italic">
                          {ev.startDate === ev.endDate ? formatDate(ev.startDate) : `${formatDate(ev.startDate)} - ${formatDate(ev.endDate)}`}
                        </p>
                        {getDaysUntil(ev.startDate) <= 0 && getDaysUntil(ev.endDate) >= 0 && (
                          <span className="text-[8px] font-black text-emerald-500 animate-pulse uppercase">Active</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-4 text-center opacity-20">
                  <p className="text-[8px] font-bold uppercase tracking-widest">No Events</p>
                </div>
              )}
              
              {pastEvents.length > 0 && (
                <div className="pt-2 border-t border-white/5 mt-2">
                  <p className="text-[8px] font-black text-slate-700 uppercase tracking-widest mb-2">Past Events</p>
                  <div className="space-y-1.5 opacity-50">
                    {pastEvents.slice(0, 3).map(ev => (
                      <div key={ev.id} className="flex flex-col gap-0.5 px-1 py-1 rounded hover:bg-white/[0.02]">
                        <div className="flex items-center gap-1">
                          {getEventIcon(ev.type, 8)}
                          <span className="text-[8px] font-bold text-slate-400 uppercase truncate">{ev.title}</span>
                        </div>
                        <p className="text-[6px] text-slate-600 font-mono italic">
                          {ev.startDate === ev.endDate ? formatDate(ev.startDate) : `${formatDate(ev.startDate)} - ${formatDate(ev.endDate)}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fleet Matrix & Analytics Pulse */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div className="theme-container overflow-hidden p-0 flex flex-col xl:flex-row bg-[#0d0d0f] min-h-[320px]">
            {/* Left: Rotation Matrix (Compact Width) */}
            <div className="w-full xl:w-[40%] p-5 border-b xl:border-b-0 xl:border-r border-white/5 bg-white/[0.01] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="text-emerald-500" size={14} />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Rotation Status</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]"></div>
                  <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">Live deployment</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 flex-1">
                {uniqueGroups.filter(g => g && g !== 'ALL').map(group => {
                  const members = personnel.filter(p => p.rosterGroup === group);
                  const today = new Date().toISOString().split('T')[0];
                  const groupSchedules = schedules.filter(s => 
                    members.some(m => m.id === s.personnelId) && 
                    today >= s.startDate && today <= s.endDate
                  );
                  
                  const onDuty = groupSchedules.filter(s => s.status === 'ON_DUTY').length;
                  const inTransit = groupSchedules.filter(s => s.status === 'TRANSIT').length;
                  
                  const status = onDuty > 0 ? 'ON_DUTY' : inTransit > 0 ? 'IN_TRANSIT' : 'OFF_DUTY';
                  const colorClass = status === 'ON_DUTY' ? 'emerald' : status === 'IN_TRANSIT' ? 'amber' : 'blue';

                  return (
                    <div key={group} className={cn("p-2.5 rounded border border-white/5 transition-all hover:bg-white/[0.02]", `bg-${colorClass}-500/5`)}>
                <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[13px] font-black text-white">{group.startsWith('Group') ? group.replace('Group ', 'GP') : `GP ${group}`}</span>
                        <span className={cn("text-[9px] font-black uppercase", `text-${colorClass}-400`)}>
                          {status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex -space-x-1.5">
                          {members.slice(0, 3).map((p, i) => (
                            <div key={p.id} className="w-6 h-6 rounded-full border border-[#0d0d0f] bg-slate-800 flex items-center justify-center text-[9px] text-white font-bold uppercase">
                              {p.fullName.charAt(0)}
                            </div>
                          ))}
                        </div>
                        <span className="text-[11px] font-mono text-slate-500">{members.length} PX</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Pulse Analytics */}
            <div className="flex-1 p-5 flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Plane className="text-blue-500" size={14} />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Logistics Pulse</h3>
                </div>
                <div className="flex gap-3">
                   <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm bg-blue-500/40"></div>
                      <span className="text-[8px] text-slate-500 font-bold uppercase">DZ-ID</span>
                   </div>
                   <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-sm bg-emerald-500/40"></div>
                      <span className="text-[8px] text-slate-500 font-bold uppercase">ID-DZ</span>
                   </div>
                </div>
              </div>

              <div className="flex-1 min-h-[140px] mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[...availableMonths].sort().map(m => ({
                    month: formatPeriod(m),
                    dz_id: allFlights.filter(f => f.requestedDateDZtoID?.startsWith(m)).length,
                    id_dz: allFlights.filter(f => f.requestedDateIDtoDZ?.startsWith(m)).length,
                  })).slice(0, 12)}>
                    <defs>
                      <linearGradient id="colorDz" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorId" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" vertical={false} />
                    <XAxis 
                      dataKey="month" 
                      stroke="rgba(255,255,255,0.2)" 
                      fontSize={7} 
                      tickLine={false} 
                      axisLine={false}
                      interval={0}
                    />
                    <YAxis hide />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#111', border: 'none', borderRadius: '4px', fontSize: '9px' }}
                    />
                    <Area type="monotone" dataKey="dz_id" stroke="#3b82f6" fillOpacity={1} fill="url(#colorDz)" strokeWidth={2} />
                    <Area type="monotone" dataKey="id_dz" stroke="#10b981" fillOpacity={1} fill="url(#colorId)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-white/5">
                <div>
                  <p className="text-[8px] text-slate-500 font-black uppercase mb-1 tracking-widest">Yearly Volume</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-mono text-white font-black">
                      {allFlights.filter(f => {
                         const yr = new Date().getFullYear().toString();
                         return f.requestedDateDZtoID?.startsWith(yr) || f.requestedDateIDtoDZ?.startsWith(yr);
                      }).length}
                    </span>
                    <span className="text-[9px] text-emerald-500 font-bold tracking-widest">MOVEMENTS</span>
                  </div>
                </div>
                <div className="border-l border-white/5 pl-6">
                  <p className="text-[8px] text-slate-500 font-black uppercase mb-1 tracking-widest">Pipeline Health</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-mono text-white font-black">
                      {(() => {
                        const currentMonth = new Date().toISOString().substring(0, 7);
                        const currentFlights = allFlights.filter(f => 
                          f.requestedDateDZtoID?.startsWith(currentMonth) || 
                          f.requestedDateIDtoDZ?.startsWith(currentMonth)
                        );
                        if (currentFlights.length === 0) return "100%";
                        const booked = currentFlights.filter(f => {
                          const dzidReady = !f.requestedDateDZtoID || f.statusDZtoID === 'Received';
                          const iddzReady = !f.requestedDateIDtoDZ || f.statusIDtoDZ === 'Received';
                          return dzidReady && iddzReady;
                        }).length;
                        return `${Math.round((booked / currentFlights.length) * 100)}%`;
                      })()}
                    </span>
                    <span className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">READY</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* --- LABOR ANALYTICS SECTION --- */}
        <div className="lg:col-span-2 theme-container p-6 bg-[#0a0a0c] border border-white/5 relative overflow-hidden group">
          {/* Subtle Background Glow */}
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Activity size={14} className="text-blue-500" />
                  <h3 className="text-xs font-black text-white uppercase tracking-[0.2em]">Labor Force Profile</h3>
                </div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Personnel Deployment vs Cumulative Work Hours (12h/Day)</p>
              </div>
              
              <div className="flex items-center gap-3">
                {/* Group Filter */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/10 rounded-lg group/filter hover:bg-white/[0.05] transition-colors">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">GP:</span>
                  <select 
                    value={selectedGroup} 
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    className="bg-transparent text-[10px] font-black text-white focus:outline-none uppercase cursor-pointer"
                  >
                    <option value="ALL">ALL</option>
                    {uniqueGroups.map(g => <option key={g} value={g} className="bg-[#111]">{g}</option>)}
                  </select>
                </div>

                {/* Period Selector */}
                <div className="relative">
                  <button 
                    onClick={() => setIsPeriodMenuOpen(!isPeriodMenuOpen)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/10 rounded-lg hover:bg-white/[0.05] transition-all",
                      isPeriodMenuOpen && "border-blue-500/50 bg-blue-500/5"
                    )}
                  >
                    <Calendar size={12} className={cn("transition-colors", isPeriodMenuOpen ? "text-blue-400" : "text-slate-400")} />
                    <span className="text-[10px] font-black text-white uppercase tracking-widest min-w-[60px] text-left">
                      {selectedPeriods.length === 0 ? 'LIFETIME' : 
                       selectedPeriods.length === 1 ? formatPeriod(selectedPeriods[0]) :
                       `${selectedPeriods.length} MONTHS`}
                    </span>
                  </button>
                  
                  {isPeriodMenuOpen && (
                    <>
                      {/* Invisible backdrop for click-away */}
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsPeriodMenuOpen(false)} 
                      />
                      
                      <div className="absolute top-full right-0 mt-2 w-52 bg-[#0d0d0f] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-2 border-b border-white/5 bg-white/[0.02]">
                          <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest px-2">Select Active Periods</p>
                        </div>
                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                          <div 
                            onClick={() => {
                              setSelectedPeriods([]);
                              setIsPeriodMenuOpen(false); // Close on lifetime selection as it's a "reset"
                            }}
                            className={cn(
                              "px-4 py-2 text-[10px] font-bold uppercase cursor-pointer transition-colors hover:bg-white/5 flex items-center gap-3",
                              selectedPeriods.length === 0 ? "text-blue-500 bg-blue-500/5" : "text-slate-400"
                            )}
                          >
                            <div className={cn(
                              "w-3 h-3 rounded border flex items-center justify-center transition-colors",
                              selectedPeriods.length === 0 ? "border-blue-500 bg-blue-500" : "border-white/10"
                            )}>
                              {selectedPeriods.length === 0 && <CheckCircle2 size={8} className="text-white" />}
                            </div>
                            Reset All (Lifetime)
                          </div>
                          {availableMonths.map(m => {
                            const isSelected = selectedPeriods.includes(m);
                            return (
                              <div 
                                key={m}
                                onClick={() => togglePeriod(m)}
                                className={cn(
                                  "px-4 py-2 text-[10px] font-bold uppercase cursor-pointer flex items-center gap-3 hover:bg-white/5 transition-colors",
                                  isSelected ? "text-blue-500 bg-blue-500/5" : "text-slate-400"
                                )}
                              >
                                <div className={cn(
                                  "w-3 h-3 rounded border flex items-center justify-center transition-colors",
                                  isSelected ? "border-blue-500 bg-blue-500" : "border-white/10"
                                )}>
                                  {isSelected && <CheckCircle2 size={8} className="text-white" />}
                                </div>
                                {formatPeriod(m)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="h-[450px] w-full">
              {laborAnalytics.chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={laborAnalytics.chartData} 
                    margin={{ top: 20, right: 30, left: 10, bottom: 80 }}
                    barGap={0}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                    <XAxis 
                      dataKey="name" 
                      stroke="rgba(255,255,255,0.4)" 
                      fontSize={13} 
                      fontWeight="900" 
                      tickLine={false} 
                      axisLine={false} 
                      interval={0}
                      angle={-45}
                      textAnchor="end"
                    />
                    <YAxis 
                      stroke="rgba(255,255,255,0.3)" 
                      fontSize={10} 
                      fontWeight="black"
                      tickLine={false} 
                      axisLine={false}
                      label={{ value: 'HOURS', angle: -90, position: 'insideLeft', offset: 0, fontSize: 8, fill: 'rgba(255,255,255,0.2)', fontWeight: 'bold' }}
                    />
                    <RechartsTooltip 
                      cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-[#000] border border-white/10 p-3 rounded-lg shadow-2xl backdrop-blur-md">
                              <p className="text-[10px] font-black text-white uppercase mb-1">{data.name}</p>
                              <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: groupColorMap[data.group] || '#3b82f6' }} />
                                <p className="text-[9px] font-bold text-slate-400 uppercase">{data.group}</p>
                              </div>
                              <p className="text-[14px] font-mono font-black text-blue-500 mt-1">{data.hours.toLocaleString()} HR</p>
                              <p className="text-[8px] text-slate-600 font-bold uppercase mt-1">Status: Verified Deployment</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar 
                      dataKey="hours" 
                      radius={[4, 4, 0, 0]} 
                      animationDuration={1500}
                    >
                      <LabelList 
                        dataKey="hours" 
                        position="top" 
                        fill="rgba(255,255,255,0.6)" 
                        fontSize={10} 
                        fontWeight="black"
                        formatter={(val: number) => val.toLocaleString()}
                      />
                      {laborAnalytics.chartData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={groupColorMap[entry.group] || '#3b82f6'} 
                          fillOpacity={0.8}
                          stroke={groupColorMap[entry.group] || '#3b82f6'}
                          strokeWidth={1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center bg-white/[0.01] border border-dashed border-white/5 rounded-3xl group-hover:border-blue-500/10 transition-colors">
                  <div className="relative">
                    <Activity size={64} className="text-slate-800 mb-4 animate-pulse" />
                    <AlertCircle size={20} className="absolute -top-2 -right-2 text-rose-500/40" />
                  </div>
                  <h4 className="text-[14px] font-black text-slate-500 uppercase tracking-[0.3em]">No Deployment Data</h4>
                  <p className="text-[9px] text-slate-700 uppercase mt-2 font-bold tracking-widest">Verify personnel status and period range</p>
                </div>
              )}
            </div>
            
            {/* Legend / Stats overlay */}
            <div className="absolute bottom-6 right-6 flex flex-col gap-2 pointer-events-none">
              <div className="bg-black/80 backdrop-blur-md border border-white/5 p-3 rounded-lg text-right">
                <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest leading-none mb-1">Total Working Hours</p>
                <p className="text-xl font-mono font-black text-white">{laborAnalytics.totalHours.toLocaleString()}<span className="text-[10px] text-blue-500 ml-1">HRS</span></p>
              </div>
            </div>
          </div>
        </div>

        {/* Personnel Status Manifest */}
        <div className="theme-card p-5 flex flex-col max-h-[400px]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">Live Manifest</h3>
              <p className="text-[11px] text-slate-500 uppercase mt-0.5">Real-time presence</p>
            </div>
            <Users size={12} className="text-blue-500" />
          </div>
          
          <div className="space-y-1.5 overflow-y-auto custom-scrollbar pr-1 flex-1">
            {personnel.map(p => {
               const now = new Date();
               now.setHours(0,0,0,0);
               const activeSched = schedules.find(s => {
                 const start = toDate(s.startDate);
                 const end = toDate(s.endDate);
                 if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return false;
                 const startTime = new Date(start).setHours(0,0,0,0);
                 const endTime = new Date(end).setHours(0,0,0,0);
                 return s.personnelId === p.id && 
                        now.getTime() >= startTime && 
                        now.getTime() <= endTime;
               });
               const isOnDuty = activeSched?.status?.toUpperCase() === 'ON_DUTY';
               const isTransit = activeSched?.status?.toUpperCase() === 'TRANSIT';
               return { p, isOnDuty, isTransit };
            })
            .sort((a,b) => {
              if (a.isOnDuty && !b.isOnDuty) return -1;
              if (!a.isOnDuty && b.isOnDuty) return 1;
              return 0;
            })
            .map(({ p, isOnDuty, isTransit }) => (
              <div key={p.id} className="flex items-center justify-between p-2.5 rounded bg-white/[0.01] border border-white/5 hover:bg-white/[0.03] transition-all">
                <div className="flex items-center gap-2.5">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isOnDuty ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" : isTransit ? "bg-blue-400" : "bg-slate-700"
                  )} />
                  <p className="text-[11px] font-bold text-slate-200 uppercase tracking-tighter truncate max-w-[120px]">{p.fullName}</p>
                </div>
                <span className={cn(
                  "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border",
                  isOnDuty ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : 
                  isTransit ? "bg-blue-400/10 text-blue-400 border-blue-400/20" : 
                  "bg-slate-500/10 text-slate-500 border-slate-500/20"
                )}>
                  {isOnDuty ? 'On Duty' : isTransit ? 'Transit' : 'Off Duty'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Logistics Intelligence Row */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Fulfillment Sync (Pie Chart) */}
        <div className="lg:col-span-1 theme-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Fulfillment Sync</h3>
              <p className="text-[8px] text-slate-500 uppercase mt-0.5">Ticket Completion Ratio</p>
            </div>
            <CheckCircle2 size={12} className="text-emerald-500" />
          </div>
          <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={statusData} 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={45} 
                  outerRadius={60} 
                  paddingAngle={5}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={statusColorMap[entry.name] || COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#111', border: 'none', borderRadius: '4px', fontSize: '9px' }} 
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
             {statusData.slice(0, 4).map((item) => (
                <div key={item.name} className="flex flex-col p-1.5 bg-white/[0.02] border border-white/5 rounded">
                   <span className="text-[7px] text-slate-500 uppercase tracking-widest truncate">{item.name}</span>
                   <span className="text-[10px] text-white font-bold">{item.value}</span>
                </div>
             ))}
          </div>
        </div>

        {/* Awaiting Fulfillment (Feed) */}
        <div className="lg:col-span-2 theme-card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock size={12} className="text-rose-500" />
              <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Awaiting Ops Action</h3>
            </div>
            <span className="text-[8px] font-mono text-rose-500/50 uppercase">Urgent Priority</span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1 max-h-[300px]">
             {allFlights
               .filter(f => f.statusDZtoID === 'Requested' || f.statusIDtoDZ === 'Requested')
               .sort((a, b) => {
                 const getEarliestReq = (f: FlightRequest) => {
                   const dates = [];
                   if (f.statusDZtoID === 'Requested') dates.push(new Date(f.requestedDateDZtoID!).getTime());
                   if (f.statusIDtoDZ === 'Requested') dates.push(new Date(f.requestedDateIDtoDZ!).getTime());
                   return dates.length > 0 ? Math.min(...dates) : Infinity;
                 };
                 return getEarliestReq(a) - getEarliestReq(b);
               })
               .map((f) => {
                const person = personnel.find(p => p.id === f.personnelId);
                return (
                   <div key={f.id} className="p-2.5 rx-2 rounded bg-black/40 border border-white/5 flex items-center justify-between group hover:border-rose-500/20 transition-all">
                      <div className="flex items-center gap-3">
                         <div className="w-9 h-9 rounded bg-slate-800 flex items-center justify-center text-[12px] font-black text-white border border-white/5">
                            {person?.fullName.charAt(0)}
                         </div>
                         <div>
                            <p className="text-[12px] text-white font-bold uppercase leading-tight">{person?.fullName}</p>
                            <p className="text-[9px] text-slate-600 font-mono">REQ-{f.id.slice(0,8)}</p>
                         </div>
                      </div>
                      <div className="flex items-center gap-6">
                         {f.requestedDateDZtoID && f.statusDZtoID === 'Requested' && (
                           <div className="text-right">
                             <p className="text-[9px] font-black text-blue-500 uppercase">Algeria → Indonesia</p>
                             <p className="text-[11px] text-slate-200 font-mono font-bold leading-none">{formatDate(f.requestedDateDZtoID)}</p>
                             <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">
                               {getDaysUntil(f.requestedDateDZtoID) === 0 ? 'DUE TODAY' : 
                                getDaysUntil(f.requestedDateDZtoID) < 0 ? 'PAST DUE' : 
                                `${getDaysUntil(f.requestedDateDZtoID)}d remaining`}
                             </p>
                           </div>
                         )}
                         {f.requestedDateIDtoDZ && f.statusIDtoDZ === 'Requested' && (
                           <div className="text-right">
                             <p className="text-[9px] font-black text-emerald-500 uppercase">Indonesia → Algeria</p>
                             <p className="text-[11px] text-slate-200 font-mono font-bold leading-none">{formatDate(f.requestedDateIDtoDZ)}</p>
                             <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">
                               {getDaysUntil(f.requestedDateIDtoDZ) === 0 ? 'DUE TODAY' : 
                                getDaysUntil(f.requestedDateIDtoDZ) < 0 ? 'PAST DUE' : 
                                `${getDaysUntil(f.requestedDateIDtoDZ)}d remaining`}
                             </p>
                           </div>
                         )}
                         <ArrowRight size={12} className="text-slate-700 group-hover:text-rose-500 transition-colors" />
                      </div>
                   </div>
                );
             })}
             {allFlights.filter(f => f.statusDZtoID === 'Requested' || f.statusIDtoDZ === 'Requested').length === 0 && (
                <div className="h-full flex flex-col items-center justify-center opacity-10 py-10">
                   <CheckCircle2 size={32} className="mb-2" />
                   <p className="text-[10px] font-black uppercase tracking-[0.3em]">All Clear</p>
                </div>
             )}
          </div>
        </div>

        {/* Allocation Progress */}
        <div className="lg:col-span-1 theme-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[12px] font-black text-white uppercase tracking-widest">Group Allocation</h3>
              <p className="text-[10px] text-slate-500 uppercase mt-0.5">Distribution</p>
            </div>
            <LayoutGrid size={12} className="text-orange-500" />
          </div>
          <div className="space-y-3">
             {uniqueGroups.slice(0, 5).map((g) => {
               const groupPersonnel = personnel.filter(p => p.rosterGroup === g);
               const percent = stats.totalPersonnel ? Math.round((groupPersonnel.length / stats.totalPersonnel) * 100) : 0;
               return (
                 <div key={g} className="space-y-1">
                   <div className="flex justify-between text-[8px] font-bold uppercase">
                     <span className="text-slate-500">{g}</span>
                     <span className="text-slate-600">{groupPersonnel.length} PAX</span>
                   </div>
                   <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                     <div className="h-full bg-blue-600 rounded-full" style={{ width: `${percent}%` }}></div>
                   </div>
                 </div>
               );
             })}
          </div>
        </div>
      </div>

      {/* Manifest Row */}
      <div className="theme-container overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white">Flight Ticket Requests Summary</h2>
          <div className="flex flex-wrap items-center gap-4">
             <div className="flex items-center gap-2 px-2 py-1 bg-black/40 border border-white/5 rounded-lg text-[9px]">
                <Users size={10} className="text-slate-500" />
                <select 
                  value={summaryGroup} 
                  onChange={(e) => setSummaryGroup(e.target.value)}
                  className="bg-transparent text-slate-300 focus:outline-none uppercase font-bold"
                >
                  <option value="ALL">Groups</option>
                  {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
             </div>
             <div className="flex items-center gap-2 px-2 py-1 bg-black/40 border border-white/5 rounded-lg text-[9px]">
                <Users size={10} className="text-slate-500" />
                <select 
                  value={summaryPersonnel} 
                  onChange={(e) => setSummaryPersonnel(e.target.value)}
                  className="bg-transparent text-slate-300 focus:outline-none uppercase font-bold max-w-[100px]"
                >
                  <option value="ALL">Staff</option>
                  {personnel.sort((a,b) => a.fullName.localeCompare(b.fullName)).map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
             </div>
             <div className="flex items-center gap-2 px-2 py-1 bg-black/40 border border-white/5 rounded-lg text-[9px]">
                <Calendar size={10} className="text-slate-500" />
                <select 
                  value={summaryMonth} 
                  onChange={(e) => setSummaryMonth(e.target.value)}
                  className="bg-transparent text-slate-300 focus:outline-none uppercase font-bold"
                >
                  <option value="ALL">Month</option>
                  {availableMonths.map(m => <option key={m} value={m}>{formatPeriod(m)}</option>)}
                </select>
             </div>
             <div className="flex items-center gap-2 px-2 py-1 bg-black/40 border border-white/5 rounded-lg text-[9px]">
                <Activity size={10} className="text-slate-500" />
                <select 
                  value={summaryStatus} 
                  onChange={(e) => setSummaryStatus(e.target.value)}
                  className="bg-transparent text-slate-300 focus:outline-none uppercase font-bold"
                >
                  <option value="ALL">Status</option>
                  <option value="Requested">Requested</option>
                  <option value="Received">Received</option>
                  <option value="Need Action">Need Action</option>
                  <option value="Pending">Pending</option>
                </select>
             </div>
             <button 
               onClick={exportToExcel}
               className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[9px] font-black uppercase transition-all shadow-lg shadow-emerald-900/20"
             >
               <Download size={12} />
               Export Excel
             </button>
             <div className="flex items-center gap-2 hidden md:flex">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span className="text-[9px] text-slate-500 uppercase">Algeria - Indonesia</span>
             </div>
             <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="text-[9px] text-slate-500 uppercase">Indonesia - Algeria</span>
             </div>
             <Plane size={14} className="text-slate-500 ml-2" />
          </div>
        </div>
        <div className="p-0 overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[800px] md:min-w-0">
            <thead className="text-[11px] text-slate-500 uppercase tracking-widest bg-black/40">
              <tr>
                <th className="py-3 px-4 font-black border-b border-white/5">Personnel</th>
                <th className="py-3 px-4 font-black border-b border-white/5">Duty Period</th>
                <th className="py-3 px-4 font-black border-b border-white/5">Flight Intel</th>
                <th className="py-3 px-4 font-black border-b border-white/5 text-center">Status</th>
                <th className="py-3 px-4 font-black border-b border-white/5 text-right">Log ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredSummaryFlights.map((flight) => {
                const person = personnel.find(p => p.id === flight.personnelId);
                return (
                  <tr key={flight.id} className="hover:bg-white/[0.02] group transition-colors">
                    <td className="py-3 px-4">
                      <p className="text-[13px] text-slate-200 font-bold uppercase tracking-tighter">{person?.fullName || 'Crew member'}</p>
                      <p className="text-[10px] text-slate-600 font-mono italic">{person?.title || 'System ID: ' + flight.id.slice(0,4)}</p>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono whitespace-nowrap">
                         <Calendar size={12} className="text-slate-700" />
                         {flight.startDate ? `${formatDate(flight.startDate)} — ${formatDate(flight.endDate)}` : 'Unscheduled'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1 min-w-[220px]">
                        {flight.requestedDateIDtoDZ && (
                          <div className="flex items-center gap-2">
                            <ArrowLeft size={10} className="text-emerald-500" />
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-slate-400 font-mono tracking-tighter">Indonesia-Algeria ({formatDate(flight.requestedDateIDtoDZ)})</span>
                              {(flight.statusIDtoDZ === 'Requested' || flight.statusIDtoDZ === 'Not Requested' || flight.statusIDtoDZ === 'Need Action') && (
                                <span className="text-[9px] text-slate-500 font-bold uppercase whitespace-nowrap">
                                  {getDaysUntil(flight.requestedDateIDtoDZ) === 0 ? 'TODAY' : 
                                   getDaysUntil(flight.requestedDateIDtoDZ) < 0 ? 'OVERDUE' : 
                                   `${getDaysUntil(flight.requestedDateIDtoDZ)}d rem`}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {flight.requestedDateDZtoID && (
                          <div className="flex items-center gap-2">
                            <ArrowRight size={10} className="text-blue-500" />
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-slate-400 font-mono tracking-tighter">Algeria-Indonesia ({formatDate(flight.requestedDateDZtoID)})</span>
                              {(flight.statusDZtoID === 'Requested' || flight.statusDZtoID === 'Not Requested' || flight.statusDZtoID === 'Need Action') && (
                                <span className="text-[9px] text-slate-500 font-bold uppercase whitespace-nowrap">
                                  {getDaysUntil(flight.requestedDateDZtoID) === 0 ? 'TODAY' : 
                                   getDaysUntil(flight.requestedDateDZtoID) < 0 ? 'OVERDUE' : 
                                   `${getDaysUntil(flight.requestedDateDZtoID)}d rem`}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex flex-col items-center gap-1.5">
                        {flight.requestedDateIDtoDZ && (
                          <span className={cn(
                            "text-[9px] font-black uppercase px-2 py-0.5 rounded border w-fit whitespace-nowrap",
                            getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ) === 'Need Action'
                              ? "text-rose-500 bg-rose-500/10 border-rose-500/20"
                              : flight.statusIDtoDZ === 'Received'
                                ? "text-emerald-400 bg-emerald-500/20 border-emerald-500/30"
                                : "text-emerald-400 bg-emerald-500/5 border-emerald-500/10"
                          )}>
                            {getStatusLabel(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ)}
                          </span>
                        )}
                        {flight.requestedDateDZtoID && (
                          <span className={cn(
                            "text-[9px] font-black uppercase px-2 py-0.5 rounded border w-fit whitespace-nowrap",
                            getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID) === 'Need Action'
                              ? "text-rose-500 bg-rose-500/10 border-rose-500/20"
                              : flight.statusDZtoID === 'Received' 
                                ? "text-blue-400 bg-blue-500/20 border-blue-500/30"
                                : "text-blue-400 bg-blue-500/5 border-blue-500/10"
                          )}>
                            {getStatusLabel(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[10px] text-slate-700">
                      ID-{flight.id.slice(0,8).toUpperCase()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredSummaryFlights.length === 0 && (
            <div className="py-20 text-center opacity-20">
              <Plane size={32} className="mx-auto mb-2" />
              <p className="text-[10px] font-mono uppercase">System Idle - All Transits Cleared</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
