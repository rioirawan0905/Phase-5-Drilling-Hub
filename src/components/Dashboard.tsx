import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { FlightRequest, Personnel, Scheduling } from '../types';
import { PieChart, Pie, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Users, Plane, Activity, CheckCircle2, AlertCircle, Clock, Filter, Calendar, Briefcase, LayoutGrid, ArrowRight, ArrowLeft, Download, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from '../lib/utils';
import * as XLSX from 'xlsx';

interface DashboardProps {
  isGuest?: boolean;
}

export function Dashboard({ isGuest }: DashboardProps) {
  const [stats, setStats] = useState({
    totalPersonnel: 0,
    onDutyPercent: 0,
    pendingFlights: 0,
    completedFlights: 0,
    onDutyCount: 0
  });

  const [recentFlights, setRecentFlights] = useState<FlightRequest[]>([]);
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
  
  // Summary Table Filters
  const [summaryGroup, setSummaryGroup] = useState<string>('ALL');
  const [summaryPersonnel, setSummaryPersonnel] = useState<string>('ALL');
  const [summaryMonth, setSummaryMonth] = useState<string>('ALL');

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
        const start = new Date(s.startDate);
        const end = new Date(s.endDate);
        return s.status === 'ON_DUTY' && now >= start && now <= end;
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

    return () => {
      personnelUnsub();
      schedulesUnsub();
      flightsUnsub();
    };
  }, [stats.totalPersonnel]);

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

  const laborAnalytics = useMemo(() => {
    let filteredSchedules = schedules;

    // Apply Filters
    if (selectedPersonnel !== 'ALL') {
      filteredSchedules = filteredSchedules.filter(s => s.personnelId === selectedPersonnel);
    }

    if (selectedGroup !== 'ALL') {
      const personnelInGroup = personnel.filter(p => p.rosterGroup === selectedGroup).map(p => p.id);
      filteredSchedules = filteredSchedules.filter(s => personnelInGroup.includes(s.personnelId));
    }

    if (selectedPeriods.length > 0) {
      filteredSchedules = filteredSchedules.filter(s => {
        const start = s.startDate.substring(0, 7); // YYYY-MM
        const end = s.endDate.substring(0, 7);
        return selectedPeriods.includes(start) || selectedPeriods.includes(end);
      });
    }

    // Calculate Hours
    let totalHoursCount = 0;
    const personnelHoursMap: Record<string, number> = {};

    filteredSchedules.forEach(s => {
      if (s.status === 'ON_DUTY') {
        const start = new Date(s.startDate);
        const end = new Date(s.endDate);
        const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const hours = days * 12;
        
        totalHoursCount += hours;
        personnelHoursMap[s.personnelId] = (personnelHoursMap[s.personnelId] || 0) + hours;
      }
    });

    const cData = Object.entries(personnelHoursMap)
      .map(([id, hours]) => {
        const p = personnel.find(p => p.id === id);
        return {
          name: p?.fullName || 'Unknown',
          hours,
          group: p?.rosterGroup || 'A'
        };
      })
      .sort((a, b) => b.hours - a.hours);

    return { totalHours: totalHoursCount, chartData: cData };
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
      return true;
    }).sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
  }, [allFlights, personnel, summaryGroup, summaryPersonnel, summaryMonth]);

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

  const uniqueGroups = useMemo(() => [...new Set(personnel.map(p => p.rosterGroup))], [personnel]);
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    schedules.forEach(s => {
      months.add(s.startDate.substring(0, 7));
      months.add(s.endDate.substring(0, 7));
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
                <Info size={10} className="text-slate-600 cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-[#16161a] border border-white/10 rounded text-[8px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none shadow-2xl">
                  Percentage of total personnel currently on-site and on active duty.
                </div>
              </div>
            )
          }
        ].map((item, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
            key={item.label} className="theme-card p-3 md:p-6"
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-[8px] md:text-[10px] text-slate-500 uppercase tracking-widest truncate">{item.label}</p>
              {item.extra}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-baseline gap-0 md:gap-2">
              <span className={cn("text-lg md:text-2xl font-light", item.color)}>{item.val}</span>
              <span className="text-[7px] md:text-[10px] text-slate-500 leading-none truncate">{item.sub}</span>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Labor Analytics Component */}
        <div className="lg:col-span-2 theme-container p-4 md:p-6 bg-white/[0.01]">
          <div className="flex flex-col sm:flex-row justify-between gap-4 md:gap-6 mb-8">
            <div>
              <h3 className="text-[10px] md:text-xs font-bold text-white uppercase tracking-widest">Labor Force Analytics</h3>
              <p className="text-[8px] md:text-[10px] text-slate-500 uppercase mt-1">Automatic Calculation: (Days On-Duty × 12h)</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <div className="flex items-center gap-2 px-2 md:px-3 py-1 bg-black/40 border border-white/5 rounded-lg text-[8px] md:text-[9px]">
                <Users size={10} className="text-slate-500" />
                <select 
                  value={selectedGroup} 
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="bg-transparent text-slate-300 focus:outline-none uppercase font-bold"
                >
                  <option value="ALL">All Groups</option>
                  {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 px-2 md:px-3 py-1 bg-black/40 border border-white/5 rounded-lg text-[8px] md:text-[9px]">
                <Users size={10} className="text-slate-500" />
                <select 
                  value={selectedPersonnel} 
                  onChange={(e) => setSelectedPersonnel(e.target.value)}
                  className="bg-transparent text-slate-300 focus:outline-none uppercase font-bold"
                >
                  <option value="ALL">All Staff</option>
                  {personnel.sort((a,b) => a.fullName.localeCompare(b.fullName)).map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 px-2 md:px-3 py-1 bg-black/40 border border-white/5 rounded-lg text-[8px] md:text-[9px] relative group/select">
                <Calendar size={10} className="text-slate-500" />
                <button className="bg-transparent text-slate-300 focus:outline-none uppercase font-bold min-w-[80px] text-left">
                  {selectedPeriods.length === 0 ? 'All Periods' : 
                   selectedPeriods.length === 1 ? formatPeriod(selectedPeriods[0]) :
                   `${selectedPeriods.length} Periods`}
                </button>
                <div className="absolute top-full left-0 mt-1 w-48 max-h-60 overflow-y-auto bg-[#16161a] border border-white/10 rounded-lg shadow-2xl z-50 hidden group-hover/select:block custom-scrollbar">
                  <div 
                    onClick={() => togglePeriod('ALL')}
                    className={cn(
                      "px-4 py-2 text-[10px] uppercase font-bold transition-colors cursor-pointer",
                      selectedPeriods.length === 0 ? "text-blue-500 bg-blue-500/5" : "text-slate-400 hover:text-white"
                    )}
                  >
                    All Periods
                  </div>
                  {availableMonths.map(m => (
                    <div 
                      key={m}
                      onClick={() => togglePeriod(m)}
                      className={cn(
                        "px-4 py-2 text-[10px] uppercase font-bold transition-colors cursor-pointer flex justify-between items-center",
                        selectedPeriods.includes(m) ? "text-blue-500 bg-blue-500/5" : "text-slate-400 hover:text-white"
                      )}
                    >
                      {formatPeriod(m)}
                      {selectedPeriods.includes(m) && <CheckCircle2 size={10} />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8">
            <div className="h-[220px] md:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={laborAnalytics.chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={7} tickLine={false} axisLine={false} interval={0} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={7} tickLine={false} axisLine={false} />
                  <RechartsTooltip 
                    cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                    contentStyle={{ backgroundColor: 'var(--theme-card)', border: '1px solid var(--theme-border)', borderRadius: '8px', fontSize: '9px' }}
                  />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                    {laborAnalytics.chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={groupColorMap[entry.group] || '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Personnel Status Manifest */}
        <div className="theme-card p-6 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-widest">Live Manifest</h3>
              <p className="text-[10px] text-slate-500 uppercase mt-1">Real-time status</p>
            </div>
            <Users size={14} className="text-blue-500" />
          </div>
          
          <div className="space-y-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-2 flex-1">
            {personnel.map(p => {
               const now = new Date();
               now.setHours(0,0,0,0);
               const activeSched = schedules.find(s => 
                 s.personnelId === p.id && 
                 new Date(s.startDate) <= now && 
                 new Date(s.endDate) >= now
               );
               const isOnDuty = activeSched?.status === 'ON_DUTY';
               const isTransit = activeSched?.status === 'TRANSIT';
               return { p, isOnDuty, isTransit };
            })
            .sort((a,b) => {
              if (a.isOnDuty && !b.isOnDuty) return -1;
              if (!a.isOnDuty && b.isOnDuty) return 1;
              if (a.isTransit && !b.isTransit) return -1;
              if (!a.isTransit && b.isTransit) return 1;
              return a.p.fullName.localeCompare(b.p.fullName);
            })
            .map(({ p, isOnDuty, isTransit }) => (
              <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 transition-all group">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isOnDuty ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)] animate-pulse" : 
                    isTransit ? "bg-blue-400" : "bg-slate-600"
                  )} />
                  <div>
                    <p className="text-[11px] font-bold text-white uppercase tracking-tighter">{p.fullName}</p>
                    <p className="text-[8px] text-slate-600 uppercase font-mono">{p.rosterGroup}</p>
                  </div>
                </div>
                <div className={cn(
                  "px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-tighter",
                  isOnDuty ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/10" : 
                  isTransit ? "bg-blue-400/10 text-blue-400 border border-blue-400/10" :
                  "bg-slate-500/10 text-slate-500 border border-slate-500/10"
                )}>
                  {isOnDuty ? 'On Duty' : isTransit ? 'Transit' : 'Off Duty'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="theme-card p-6 flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-widest">Awaiting Fulfillment</h3>
              <p className="text-[10px] text-slate-500 uppercase mt-1">Pending ticket actions</p>
            </div>
            <Clock size={12} className="text-blue-500" />
          </div>          <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1 max-h-[300px]">
             {recentFlights.filter(f => f.statusDZtoID === 'Requested' || f.statusIDtoDZ === 'Requested').slice(0, 8).map((f) => {
                const person = personnel.find(p => p.id === f.personnelId);
                return (
                  <div key={f.id} className="p-3 rounded bg-white/[0.02] border border-white/5 group hover:border-blue-500/20 transition-all">
                     <div className="flex justify-between items-start mb-1">
                        <span className="text-[11px] text-white font-bold uppercase truncate max-w-[120px]">{person?.fullName || 'Crew member'}</span>
                        <span className="font-mono text-[8px] text-slate-600">REQ-{f.id.slice(0,4)}</span>
                     </div>
                     <div className="flex flex-col gap-1.5">
                        {f.requestedDateDZtoID && f.statusDZtoID === 'Requested' && (
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[7px] font-black uppercase w-fit">DZ → ID</span>
                              <span className="text-[7px] text-slate-500 font-bold uppercase mt-1 italic">
                                {getDaysUntil(f.requestedDateDZtoID) === 0 ? 'FLIGHT TODAY' : 
                                 getDaysUntil(f.requestedDateDZtoID) < 0 ? 'PAST DUE' : 
                                 `${getDaysUntil(f.requestedDateDZtoID)} DAYS REMAINING`}
                              </span>
                            </div>
                            <span className="text-[9px] text-slate-400 font-mono italic">{formatDate(f.requestedDateDZtoID)}</span>
                          </div>
                        )}
                        {f.requestedDateIDtoDZ && f.statusIDtoDZ === 'Requested' && (
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[7px] font-black uppercase w-fit">ID → DZ</span>
                              <span className="text-[7px] text-slate-500 font-bold uppercase mt-1 italic">
                                {getDaysUntil(f.requestedDateIDtoDZ) === 0 ? 'FLIGHT TODAY' : 
                                 getDaysUntil(f.requestedDateIDtoDZ) < 0 ? 'PAST DUE' : 
                                 `${getDaysUntil(f.requestedDateIDtoDZ)} DAYS REMAINING`}
                              </span>
                            </div>
                            <span className="text-[9px] text-slate-400 font-mono italic">{formatDate(f.requestedDateIDtoDZ)}</span>
                          </div>
                        )}
                     </div>
                  </div>
                );
             })}
             {recentFlights.filter(f => f.statusDZtoID === 'Requested' || f.statusIDtoDZ === 'Requested').length === 0 && (
                <div className="h-full flex flex-col items-center justify-center opacity-20 py-10">
                   <CheckCircle2 size={24} className="mb-2" />
                   <p className="text-[10px] font-black uppercase">All clear</p>
                </div>
             )}
          </div>
        </div>

        <div className="theme-card p-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-widest">Fulfillment Sync</h3>
              <p className="text-[10px] text-slate-500 uppercase mt-1">Ticket Completion Ratio</p>
            </div>
            <CheckCircle2 size={12} className="text-emerald-500" />
          </div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={statusData} 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={50} 
                  outerRadius={70} 
                  paddingAngle={5}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={statusColorMap[entry.name] || COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: 'var(--theme-card)', border: '1px solid var(--theme-border)', borderRadius: '4px', fontSize: '9px', color: 'var(--theme-text)' }} 
                  itemStyle={{ color: 'var(--theme-text)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
             {statusData.map((item, index) => (
                <div key={item.name} className="flex flex-col p-2 bg-white/[0.02] border border-white/5 rounded">
                   <span className="text-[8px] text-slate-500 uppercase tracking-widest">{item.name}</span>
                   <span className="text-xs text-[var(--theme-text)] font-bold">{item.value}</span>
                </div>
             ))}
          </div>
        </div>

        <div className="theme-card p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-widest">Group Allocation</h3>
              <p className="text-[10px] text-slate-500 uppercase mt-1">Personnel Distribution</p>
            </div>
            <LayoutGrid size={12} className="text-orange-500" />
          </div>
          <div className="space-y-4">
             {uniqueGroups.map((g, i) => {
               const groupPersonnel = personnel.filter(p => p.rosterGroup === g);
               const groupCount = groupPersonnel.length;
               const percent = stats.totalPersonnel ? Math.round((groupCount / stats.totalPersonnel) * 100) : 0;
               return (
                 <div key={g} className="space-y-1 group/bar">
                   <div className="flex justify-between text-[10px] font-bold uppercase">
                     <span className="text-slate-400 group-hover/bar:text-white transition-colors">{g}</span>
                     <span className="text-slate-500">{groupCount} PAX <span className="text-slate-700 font-mono ml-1">({percent}%)</span></span>
                   </div>
                   <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5 shadow-inner">
                     <div className="h-full bg-blue-600 rounded-full group-hover/bar:bg-blue-400 transition-all duration-300" style={{ width: `${percent}%` }}></div>
                   </div>
                 </div>
               );
             })}
             {uniqueGroups.length === 0 && (
                <p className="text-[10px] text-slate-600 italic">No groups defined</p>
             )}
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
            <thead className="text-[10px] text-slate-500 uppercase tracking-widest bg-black/20">
              <tr>
                <th className="py-3 px-6 font-normal">Personnel Name</th>
                <th className="py-3 px-6 font-normal">Duty Period</th>
                <th className="py-3 px-6 font-normal">Flight Route</th>
                <th className="py-3 px-6 font-normal">Status</th>
                <th className="py-3 px-6 font-normal text-right">System ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredSummaryFlights.map((flight) => {
                const person = personnel.find(p => p.id === flight.personnelId);
                return (
                  <tr key={flight.id} className="hover:bg-white/[0.02] group transition-colors">
                    <td className="py-3 px-6">
                      <p className="text-xs text-[var(--theme-text)] font-bold uppercase tracking-tighter">{person?.fullName || 'Crew member'}</p>
                      <p className="text-[9px] text-slate-500 font-mono italic">{person?.title || 'System ID: ' + flight.id.slice(0,4)}</p>
                    </td>
                    <td className="py-3 px-6">
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono whitespace-nowrap">
                         <Calendar size={10} className="text-slate-600" />
                         {flight.startDate ? `${formatDate(flight.startDate)} — ${formatDate(flight.endDate)}` : 'Unscheduled'}
                      </div>
                    </td>
                    <td className="py-3 px-6">
                      <div className="flex flex-col gap-1">
                        {flight.requestedDateIDtoDZ && (
                          <div className="flex items-center gap-2">
                            <ArrowLeft size={10} className="text-emerald-500" />
                            <div className="flex flex-col">
                              <span className="text-[9px] text-slate-300 font-mono tracking-tighter">Indonesia → Algeria ({formatDate(flight.requestedDateIDtoDZ)})</span>
                              {(flight.statusIDtoDZ === 'Requested' || flight.statusIDtoDZ === 'Not Requested' || flight.statusIDtoDZ === 'Need Action') && (
                                <span className="text-[7px] text-slate-500 font-bold uppercase italic -mt-0.5">
                                  {getDaysUntil(flight.requestedDateIDtoDZ) === 0 ? 'FLIGHT TODAY' : 
                                   getDaysUntil(flight.requestedDateIDtoDZ) < 0 ? 'PAST DUE' : 
                                   `${getDaysUntil(flight.requestedDateIDtoDZ)} DAYS REMAINING`}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {flight.requestedDateDZtoID && (
                          <div className="flex items-center gap-2">
                            <ArrowRight size={10} className="text-blue-500" />
                            <div className="flex flex-col">
                              <span className="text-[9px] text-slate-300 font-mono tracking-tighter">Algeria → Indonesia ({formatDate(flight.requestedDateDZtoID)})</span>
                              {(flight.statusDZtoID === 'Requested' || flight.statusDZtoID === 'Not Requested' || flight.statusDZtoID === 'Need Action') && (
                                <span className="text-[7px] text-slate-500 font-bold uppercase italic -mt-0.5">
                                  {getDaysUntil(flight.requestedDateDZtoID) === 0 ? 'FLIGHT TODAY' : 
                                   getDaysUntil(flight.requestedDateDZtoID) < 0 ? 'PAST DUE' : 
                                   `${getDaysUntil(flight.requestedDateDZtoID)} DAYS REMAINING`}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-6">
                      <div className="flex flex-col gap-1">
                        {flight.requestedDateIDtoDZ && (
                          <span className={cn(
                            "text-[8px] font-black uppercase px-1.5 py-0.5 rounded border w-fit group-hover:scale-105 transition-transform",
                            getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ) === 'Need Action'
                              ? "text-rose-500 bg-rose-500/10 border-rose-500/20 animate-pulse font-bold"
                              : flight.statusIDtoDZ === 'Received'
                                ? "text-emerald-400 bg-emerald-500/20 border-emerald-500/30"
                                : "text-emerald-400 bg-emerald-500/5 border-emerald-500/10"
                          )}>
                            {getStatusLabel(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ)} (ID-DZ)
                          </span>
                        )}
                        {flight.requestedDateDZtoID && (
                          <span className={cn(
                            "text-[8px] font-black uppercase px-1.5 py-0.5 rounded border w-fit group-hover:scale-105 transition-transform",
                            getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID) === 'Need Action'
                              ? "text-rose-500 bg-rose-500/10 border-rose-500/20 animate-pulse font-bold"
                              : flight.statusDZtoID === 'Received' 
                                ? "text-blue-400 bg-blue-500/20 border-blue-500/30"
                                : "text-blue-400 bg-blue-500/5 border-blue-500/10"
                          )}>
                            {getStatusLabel(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID)} (DZ-ID)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-[9px] text-slate-600">
                      STAMP-{flight.createdAt?.seconds ? new Date(flight.createdAt.seconds * 1000).getHours() + ':' + new Date(flight.createdAt.seconds * 1000).getMinutes() : 'XX:XX'}
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
