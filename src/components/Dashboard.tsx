import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { FlightRequest, Personnel, Scheduling, HubEvent } from '../types';
import { PieChart, Pie, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, LabelList, LineChart, Line } from 'recharts';
import { Users, Plane, Activity, CheckCircle2, AlertCircle, Clock, Filter, Calendar, Briefcase, LayoutGrid, ArrowRight, ArrowLeft, ArrowUp, ArrowDown, Download, Info, Globe, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog, Wind, Tag, Palmtree, Wrench, Copy, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from '../lib/utils';
import * as XLSX from 'xlsx';
import { toBlob } from 'html-to-image';

import { PersonnelMap } from './PersonnelMap';

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

const sanitizeId = (id: string) => id.replace(/[^a-z0-9]/gi, '_');

// Helper for status resolution used in both stats and rendering
const getEffectiveStatus = (status: string, requestedDate?: string | null) => {
  if (status === 'Received') return "Received";
  
  let isUrgent = status === 'Need Action';
  if (requestedDate) {
    const flightDate = new Date(requestedDate);
    const today = new Date();
    const diffTime = flightDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0 && status !== 'Received') return "OVERDUE";
    if (diffDays <= 14) isUrgent = true;
  }

  if (isUrgent) return "Need Action";
  if (status === 'Not Requested') return "Pending";
  return status || "Requested";
};

export function Dashboard({ isGuest }: DashboardProps) {
  const [stats, setStats] = useState({
    totalPersonnel: 0,
    onDutyPercent: 0,
    pendingFlights: 0,
    completedFlights: 0,
    onDutyCount: 0,
    monthlyFulfillment: 0,
    healthCategory: 'Optimal' as 'Optimal' | 'Suboptimal' | 'Critical'
  });

  const getHealthCategory = (percentage: number) => {
    if (percentage >= 90) return 'Optimal';
    if (percentage >= 75) return 'Suboptimal';
    return 'Critical';
  };

  const [recentFlights, setRecentFlights] = useState<FlightRequest[]>([]);
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [routeData, setRouteData] = useState<any[]>([]);
  const [statusData, setStatusData] = useState<any[]>([]);
  const [allFlights, setAllFlights] = useState<FlightRequest[]>([]);
  const [copying, setCopying] = useState<string | null>(null);
  const [selectedAwaitingItem, setSelectedAwaitingItem] = useState<{ flight: FlightRequest, person?: Personnel } | null>(null);
  
  // Labor Stats State
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [schedules, setSchedules] = useState<Scheduling[]>([]);
  
  // Filters
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>([]); // YYYY-MM
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [selectedPersonnel, setSelectedPersonnel] = useState<string>('ALL');
  const [selectedCompany, setSelectedCompany] = useState<string>('ALL');
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  
  // Summary Table Filters
  const [summaryGroup, setSummaryGroup] = useState<string>('ALL');
  const [summaryPersonnel, setSummaryPersonnel] = useState<string>('ALL');
  const [summaryCompany, setSummaryCompany] = useState<string>('ALL');
  const [summaryMonth, setSummaryMonth] = useState<string>('ALL');
  const [summaryStatus, setSummaryStatus] = useState<string>('ALL');
  const [summaryTab, setSummaryTab] = useState<'Active' | 'Completed'>('Active');
  const [laborProfileTab, setLaborProfileTab] = useState<'individual' | 'monthly' | 'work-hours'>('individual');

  const uniqueGroups = useMemo(() => [...new Set(personnel.map(p => p.rosterGroup).filter(Boolean))].sort(), [personnel]);
  const uniqueCompanies = useMemo(() => [...new Set(personnel.map(p => p.company).filter(Boolean))].sort(), [personnel]);
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

  // Helper for weather icons
  const getWeatherIcon = (desc: string = '') => {
    const d = desc.toLowerCase();
    if (d.includes('thunder') || d.includes('lightning') || d.includes('storm')) return <CloudLightning size={12} className="text-yellow-400" />;
    if (d.includes('rain') || d.includes('shower') || d.includes('drizzle')) return <CloudRain size={12} className="text-blue-400" />;
    if (d.includes('snow') || d.includes('ice') || d.includes('hail')) return <CloudSnow size={12} className="text-white" />;
    if (d.includes('fog') || d.includes('mist') || d.includes('haze') || d.includes('smoke')) return <CloudFog size={12} className="text-slate-400" />;
    if (d.includes('cloud') || d.includes('overcast')) return <Cloud size={12} className="text-slate-300" />;
    if (d.includes('sun') || d.includes('clear')) return <Sun size={12} className="text-amber-400" />;
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
        const waqiToken = import.meta.env.VITE_WAQI_TOKEN || 'demo';
        let jkAQI = 0;
        let alAQI = 0;
        try {
          const [jkAqiRes, alAqiRes] = await Promise.all([
            fetch(`https://api.waqi.info/feed/jakarta/?token=${waqiToken}`),
            fetch(`https://api.waqi.info/feed/algiers/?token=${waqiToken}`)
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

      // Calculate Monthly Fulfillment and Health Category
      const currentMonth = new Date().toISOString().substring(0, 7);
      const currentMonthFlights = flights.filter(f => 
        f.requestedDateDZtoID?.startsWith(currentMonth) || 
        f.requestedDateIDtoDZ?.startsWith(currentMonth)
      );
      
      let bookedCount = 0;
      if (currentMonthFlights.length > 0) {
        bookedCount = currentMonthFlights.filter(f => {
          const dzidReady = !f.requestedDateDZtoID || f.statusDZtoID === 'Received';
          const iddzReady = !f.requestedDateIDtoDZ || f.statusIDtoDZ === 'Received';
          return dzidReady && iddzReady;
        }).length;
      }
      
      const fulfillmentPercentage = currentMonthFlights.length > 0 ? Math.round((bookedCount / currentMonthFlights.length) * 100) : 100;
      
      setStats(prev => ({
        ...prev,
        monthlyFulfillment: fulfillmentPercentage,
        healthCategory: getHealthCategory(fulfillmentPercentage)
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

      setStatusData(['Requested', 'Received', 'Pending', 'Need Action'].map(name => ({
        name,
        value: statCounts[name] || 0
      })));
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

    if (status === 'Not Requested') return "text-orange-500 bg-orange-500/10 border-orange-500/20"; // Pending
    if (status === 'Requested') return "text-blue-400 bg-blue-500/10 border-blue-500/20";
    return "text-indigo-400 bg-indigo-500/5 border-indigo-500/10";
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
      const matchesCompany = selectedCompany === 'ALL' || p.company === selectedCompany;
      return matchesGroup && matchesPerson && matchesCompany;
    });

    const filteredPersonnelIds = new Set(filteredPersonnel.map(p => p.id));

    // 2. Filter schedules: must be ON_DUTY, belong to filtered personnel, and match selected period
    let targetSchedules = schedules.filter(s => {
      const status = (s.status || '').toString().toUpperCase();
      const isOnDuty = status === 'ON_DUTY' || status === 'ON-DUTY';
      return isOnDuty && filteredPersonnelIds.has(s.personnelId);
    });

    // Calculate MTD (Month to Date) Hours - Independent of period selection
    const now = new Date();
    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
    mtdStart.setHours(0,0,0,0);
    const mtdEnd = new Date(now);
    mtdEnd.setHours(0,0,0,0);
    
    // Calculate YTD (Year to Date) Hours - Independent of period selection (Jan 1st to now)
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    ytdStart.setHours(0,0,0,0);

    let mtdHoursCount = 0;
    let ytdHoursCount = 0;

    targetSchedules.forEach(s => {
      const sStart = toDate(s.startDate);
      const sEnd = toDate(s.endDate);
      if (!sStart || !sEnd) return;
      
      // MTD Intersection
      const mtdIS = sStart > mtdStart ? sStart : mtdStart;
      const mtdIE = sEnd < mtdEnd ? sEnd : mtdEnd;
      if (mtdIS <= mtdIE) {
        const diffDays = Math.floor((mtdIE.getTime() - mtdIS.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        mtdHoursCount += diffDays * 12;
      }

      // YTD Intersection
      const ytdIS = sStart > ytdStart ? sStart : ytdStart;
      const ytdIE = sEnd < mtdEnd ? sEnd : mtdEnd; // Current date is the end for YTD check
      if (ytdIS <= ytdIE) {
        const diffDays = Math.floor((ytdIE.getTime() - ytdIS.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        ytdHoursCount += diffDays * 12;
      }
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

    // 5. Monthly Trends Calculation (independent of individual filters but respects general data)
    const monthlyGroupDataMap: Record<string, Record<string, number>> = {};
    const monthsForTrends: string[] = [];
    
    // Start from Jan 2026
    const trendStart = new Date("2026-01-01");
    trendStart.setHours(0,0,0,0);
    const trendEnd = new Date();
    // Add some future months if needed, but for now let's show up to current month or more
    // User said "start the x-axis from Jan 2026"
    
    let currentTrendDate = new Date(trendStart);
    while (currentTrendDate <= trendEnd || monthsForTrends.length < 6) {
      monthsForTrends.push(currentTrendDate.toISOString().substring(0, 7));
      currentTrendDate.setMonth(currentTrendDate.getMonth() + 1);
      if (monthsForTrends.length > 24) break; // Safety
    }

    // Sum hours for FILTERED personnel in each month to show trends for current selection
    schedules.filter(s => {
      const status = (s.status || '').toString().toUpperCase();
      const isActive = status === 'ON_DUTY' || status === 'ON-DUTY';
      return isActive && (selectedPersonnel === 'ALL' || s.personnelId === selectedPersonnel) && (selectedGroup === 'ALL' || personnel.find(p => p.id === s.personnelId)?.rosterGroup === selectedGroup);
    }).forEach(s => {
      const start = toDate(s.startDate);
      const end = toDate(s.endDate);
      const person = personnel.find(p => p.id === s.personnelId);
      const group = person?.rosterGroup || 'Unknown';
      if (!start || !end) return;

      monthsForTrends.forEach(m => {
        const mStart = new Date(m + "-01");
        mStart.setHours(0,0,0,0);
        const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
        mEnd.setHours(23,59,59,999);

        const intersectionStart = start > mStart ? start : mStart;
        const intersectionEnd = end < mEnd ? end : mEnd;

        if (intersectionStart <= intersectionEnd) {
          const diffDays = Math.floor((intersectionEnd.getTime() - intersectionStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          if (!monthlyGroupDataMap[m]) monthlyGroupDataMap[m] = {};
          monthlyGroupDataMap[m][group] = (monthlyGroupDataMap[m][group] || 0) + (diffDays * 12);
        }
      });
    });

    const monthlyTrends = monthsForTrends.map(m => {
      const data: any = { month: formatPeriod(m) };
      uniqueGroups.forEach(g => {
        data[g] = monthlyGroupDataMap[m]?.[g] || 0;
      });
      // also keep total for tooltip
      data.total = Object.values(monthlyGroupDataMap[m] || {}).reduce((a, b) => a + b, 0);
      return data;
    });

    // 6. Construct chart data
    const chartData = filteredPersonnel
      .map(p => ({
        id: p.id,
        name: p.fullName || 'Unknown',
        hours: hoursPerPerson[p.id] || 0,
        group: p.rosterGroup || 'A'
      }))
      .filter(item => item.hours > 0)
      .sort((a, b) => b.hours - a.hours);

    return { totalHours: totalHoursCount, chartData, mtdHours: mtdHoursCount, ytdHours: ytdHoursCount, monthlyTrends };
  }, [schedules, personnel, selectedPersonnel, selectedGroup, selectedCompany, selectedPeriods]);

  const [summarySort, setSummarySort] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'date', direction: 'asc' });

  const filteredSummaryFlights = useMemo(() => {
    let result = allFlights.filter(f => {
      const p = personnel.find(person => person.id === f.personnelId);
      if (!p) return false;
      
      if (summaryGroup !== 'ALL' && p.rosterGroup !== summaryGroup) return false;
      if (summaryCompany !== 'ALL' && p.company !== summaryCompany) return false;
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

      const hasAnyLeg = !!(f.requestedDateDZtoID || f.requestedDateIDtoDZ);
      const isCompleted = hasAnyLeg && 
                          (!f.requestedDateDZtoID || f.statusDZtoID === 'Received') && 
                          (!f.requestedDateIDtoDZ || f.statusIDtoDZ === 'Received');
      
      if (summaryTab === 'Active' && isCompleted) return false;
      if (summaryTab === 'Completed' && !isCompleted) return false;

      return true;
    });

    result = result.sort((a, b) => {
      const getEarliest = (f: FlightRequest) => {
        const dates = [f.requestedDateDZtoID, f.requestedDateIDtoDZ]
          .filter(Boolean)
          .map(d => new Date(d!).getTime());
        return dates.length > 0 ? Math.min(...dates) : Infinity;
      };

      const personA = personnel.find(p => p.id === a.personnelId);
      const personB = personnel.find(p => p.id === b.personnelId);

      let comparison = 0;
      if (summarySort.key === 'personnel') {
        comparison = (personA?.fullName || '').localeCompare(personB?.fullName || '');
      } else if (summarySort.key === 'duty') {
        comparison = (a.startDate || '').localeCompare(b.startDate || '');
      } else {
        comparison = getEarliest(a) - getEarliest(b);
      }

      return summarySort.direction === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [allFlights, personnel, summaryGroup, summaryPersonnel, summaryCompany, summaryMonth, summaryStatus, summarySort, summaryTab]);

  const flightPerformanceData = useMemo(() => {
    const data = [];
    const now = new Date();
    
    // Generate last 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
      
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const label = `${monthNames[d.getMonth()]} ${d.getDate()}`;
      
      let requestedCount = 0;
      let completedCount = 0;
      
      allFlights.forEach(f => {
        // DZ to ID leg
        if (f.requestedDateDZtoID) {
          const legDate = f.requestedDateDZtoID.split('T')[0];
          if (legDate === dateStr) {
            requestedCount++;
            if (f.statusDZtoID === 'Received') {
              completedCount++;
            }
          }
        }
        // ID to DZ leg
        if (f.requestedDateIDtoDZ) {
          const legDate = f.requestedDateIDtoDZ.split('T')[0];
          if (legDate === dateStr) {
            requestedCount++;
            if (f.statusIDtoDZ === 'Received') {
              completedCount++;
            }
          }
        }
      });
      
      data.push({
        date: dateStr,
        label,
        requests: requestedCount,
        completed: completedCount,
      });
    }
    return data;
  }, [allFlights]);

  const performanceStats = useMemo(() => {
    let totalRequests = 0;
    let totalCompleted = 0;
    
    flightPerformanceData.forEach(d => {
      totalRequests += d.requests;
      totalCompleted += d.completed;
    });
    
    const completionRate = totalRequests > 0 ? Math.round((totalCompleted / totalRequests) * 100) : 100;
    
    return {
      totalRequests,
      totalCompleted,
      completionRate,
    };
  }, [flightPerformanceData]);

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
    'COMPLETED': '#10b981',
    'Requested': '#6366f1',
    'Need Action': '#ef4444',
    'OVERDUE': '#ef4444',
    'Pending': '#f97316',
  };

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

  const calculateOnDutyDays = (personId: string, monthStr: string) => {
    const [yearStr, monthNumStr] = monthStr.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthNumStr) - 1; // 0-indexed in JS Dates
    
    // Total days in the month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let onDutyDays = 0;
    
    // Find all active ON_DUTY schedules for this person
    const personSchedules = schedules.filter(s => {
      const status = (s.status || '').toString().toUpperCase();
      const isOnDuty = status === 'ON_DUTY' || status === 'ON-DUTY';
      return s.personnelId === personId && isOnDuty;
    });
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(year, month, day);
      dayDate.setHours(12, 0, 0, 0); // avoid timezone shifts
      
      const isDayOnDuty = personSchedules.some(s => {
        const sStart = toDate(s.startDate);
        const sEnd = toDate(s.endDate);
        if (!sStart || !sEnd) return false;
        
        const startLimit = new Date(sStart);
        startLimit.setHours(0, 0, 0, 0);
        const endLimit = new Date(sEnd);
        endLimit.setHours(23, 59, 59, 999);
        
        return dayDate >= startLimit && dayDate <= endLimit;
      });
      
      if (isDayOnDuty) {
        onDutyDays++;
      }
    }
    
    return onDutyDays;
  };

  const exportOnDutyDays = () => {
    const monthsToExport = selectedPeriods.length > 0 ? selectedPeriods : availableMonths;
    const targetPersonnel = personnel.filter(p => {
      const matchesGroup = selectedGroup === 'ALL' || p.rosterGroup === selectedGroup;
      const matchesPerson = selectedPersonnel === 'ALL' || p.id === selectedPersonnel;
      return matchesGroup && matchesPerson;
    });

    const data: any[] = [];
    
    targetPersonnel.forEach(p => {
      monthsToExport.forEach(m => {
        const days = calculateOnDutyDays(p.id, m);
        if (days > 0 || (selectedPeriods.length > 0 && selectedPersonnel !== 'ALL')) {
          data.push({
            'Personnel ID': p.id,
            'Full Name': p.fullName || 'Unknown',
            'Roster Group': p.rosterGroup || 'N/A',
            'Role/Designation': p.role || 'N/A',
            'Report Month': formatPeriod(m),
            'On Duty Days': days,
            'Est. Working Hours': days * 12,
          });
        }
      });
    });

    if (data.length === 0) {
      data.push({
        'Personnel ID': 'N/A',
        'Full Name': 'No on-duty records found for selection',
        'Roster Group': 'N/A',
        'Role/Designation': 'N/A',
        'Report Month': 'N/A',
        'On Duty Days': 0,
        'Est. Working Hours': 0,
      });
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "On Duty Days Report");
    
    const groupText = selectedGroup === 'ALL' ? 'All_Groups' : `Group_${selectedGroup}`;
    const periodText = selectedPeriods.length === 0 ? 'LIFETIME' : `${selectedPeriods.length}_Months`;
    
    XLSX.writeFile(workbook, `OnDuty_Days_Report_${groupText}_${periodText}_${new Date().toISOString().split('T')[0]}.xlsx`);
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

  const copyAsImage = async (elementId: string) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    setCopying(elementId);
    
    try {
      if (!navigator.clipboard || !window.ClipboardItem) {
        throw new Error('Clipboard API not supported');
      }

      // Modern browsers (like Safari) prefer passing a promise to ClipboardItem
      // to maintain the "user gesture" context during async operations.
      const blobPromise = toBlob(el, { 
        backgroundColor: '#FFFFFF', 
        pixelRatio: 2,
        cacheBust: true
      }).then(blob => {
        if (!blob) throw new Error('Blob creation failed');
        return blob;
      });

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blobPromise })
      ]);
    } catch (e) {
      console.error('Initial copy method failed, trying fallback:', e);
      try {
        // Fallback for browsers that don't support promise-based ClipboardItem
        const blob = await toBlob(el, { backgroundColor: '#FFFFFF', pixelRatio: 2 });
        if (!blob) throw new Error('Fallback blob creation failed');
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
      } catch (err2) {
        console.error('All copy methods failed:', err2);
        alert('Could not copy image. This is often caused by security restrictions in embedded previews. Try opening the app in a new tab.');
      }
    } finally {
      setTimeout(() => setCopying(null), 2000);
    }
  };

  return (
    <div className="space-y-6 min-h-screen pb-12">
      {/* Ops Intelligence Monitor */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative group overflow-hidden theme-container bg-[var(--theme-card)] p-4 sm:p-6 md:p-8 flex flex-col lg:flex-row items-center justify-between gap-6 md:gap-8 lg:gap-12 shadow-sm"
      >
        <div className="flex items-center gap-4 md:gap-5 shrink-0 w-full lg:w-auto px-6 md:px-8 py-3 bg-blue-50 rounded-2xl md:rounded-[2rem] border border-blue-100 shadow-sm relative z-10 transition-transform hover:scale-105">
          <div className="relative">
            <Globe className="text-blue-600 animate-pulse-slow" size={20} md={24} />
            <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full -z-10 animate-pulse"></div>
          </div>
          <div className="flex flex-col">
            <h3 className="text-[10px] md:text-[12px] font-black uppercase tracking-[0.3em] md:tracking-[0.4em]" style={{ color: 'var(--theme-accent)' }}>Hub Intelligence</h3>
            <span className="text-[8px] md:text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mt-1">Status: High Precision</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8 w-full lg:w-auto flex-1 max-w-5xl relative z-10">
          {[
            { id: 'JKT', city: 'Jakarta, ID', time: times.jakarta, weather: weather?.jakarta, color: 'emerald', timezone: 'Asia/Jakarta' },
            { id: 'ALG', city: 'Algiers, DZ', time: times.algiers, weather: weather?.algiers, color: 'blue', timezone: 'Africa/Algiers' }
          ].map(location => (
            <div key={location.id} className="group relative bg-[#F8FAFC] border border-slate-100 p-4 md:p-6 rounded-2xl md:rounded-[2.5rem] transition-all hover:bg-white hover:shadow-2xl hover:shadow-blue-900/5 sm:hover:-translate-y-1">
              <div className="flex items-center justify-between gap-4 md:gap-8">
                <div className="flex items-center gap-3 md:gap-5">
                  <div className={cn("w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-[1.5rem] flex items-center justify-center font-black text-xs md:text-sm border shadow-2xl transition-all group-hover:scale-110 group-hover:rotate-6", 
                    location.id === 'JKT' ? "bg-emerald-600 text-white border-emerald-400" : "bg-blue-600 text-white border-blue-400"
                  )}>
                    {location.id}
                  </div>
                  <div className="flex flex-col">
                    <p className="text-2xl md:text-4xl font-mono font-black text-[var(--theme-text)] tracking-tighter leading-none mb-1 md:mb-3 tabular-nums drop-shadow-sm">{location.time}</p>
                    <div className="flex items-center gap-1.5 md:gap-2.5">
                      <span className="text-[9px] md:text-[11px] text-slate-400 font-extrabold uppercase tracking-widest">{new Date().toLocaleDateString('en-GB', { timeZone: location.timezone, day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      <div className="w-1 h-1 rounded-full bg-slate-200"></div>
                      <span className="text-[8px] md:text-[10px] text-slate-300 font-black uppercase tracking-tighter">{location.city.split(',')[0]}</span>
                    </div>
                  </div>
                </div>
                
                {location.weather && (
                  <div className="flex items-center gap-3 md:gap-5 pl-4 md:pl-6 border-l-2 border-slate-100">
                    <div className="flex flex-col items-center gap-1">
                      <div className="p-1 md:p-2 transition-transform group-hover:scale-125">
                        {getWeatherIcon(location.weather.desc)}
                      </div>
                      <span className="text-xs md:text-sm font-mono font-black text-slate-900">{location.weather.temp}°C</span>
                    </div>
                    <div className="hidden sm:flex flex-col items-center justify-center">
                      <span className="text-[7px] md:text-[8px] font-black text-slate-300 uppercase tracking-widest mb-1 md:mb-2">AQI</span>
                      <div className={cn("px-2 md:px-3 py-0.5 md:py-1 rounded-lg md:rounded-xl text-[9px] md:text-[11px] font-black uppercase tracking-wider border shadow-sm", 
                        location.weather.aqi <= 50 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100")}>
                        {location.weather.aqi || '--'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Personnel Strength', val: stats.totalPersonnel, sub: `+${stats.onDutyCount} Active On-Site`, color: 'text-blue-600', icon: <Users size={24} className="text-blue-400" />, bg: 'bg-blue-50' },
          { label: 'Labor Analytics', val: laborAnalytics.totalHours.toLocaleString(), sub: `YTD Working Hours: ${laborAnalytics.ytdHours.toLocaleString()}h`, color: 'text-indigo-600', icon: <Clock size={24} className="text-indigo-500" />, bg: 'bg-indigo-50' },
          { label: 'Ticket Fulfillment', val: stats.completedFlights, sub: 'Fulfillment Index', color: 'text-emerald-600', icon: <CheckCircle2 size={24} className="text-emerald-500" />, bg: 'bg-emerald-50' },
          { 
            label: 'Duty Utilization', 
            val: `${stats.onDutyPercent}%`, 
            sub: 'Optimized Efficiency', 
            color: 'text-rose-600',
            icon: <Activity size={24} className="text-rose-500" />,
            bg: 'bg-rose-50',
            extra: (
              <div className="group/tooltip relative inline-block ml-2">
                <Info size={14} className="text-slate-400 hover:text-blue-500 cursor-help transition-colors" />
                <div className="absolute bottom-full right-0 mb-4 w-64 p-4 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-2xl text-[10px] text-[var(--theme-text-muted)] font-bold opacity-0 group-hover/tooltip:opacity-100 invisible group-hover/tooltip:visible transition-all z-[100] pointer-events-none shadow-2xl uppercase tracking-widest leading-relaxed">
                  Calculated against total registered personnel capacity. Measures the efficiency of crew deployment across all operational sectors.
                </div>
              </div>
            )
          }
        ].map((item, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: i * 0.1 }}
            key={item.label} 
            className="theme-card relative group border-slate-100 hover:border-blue-100 hover:shadow-2xl hover:shadow-blue-900/5 shadow-sm"
          >
            <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none overflow-hidden rounded-[2rem] w-full h-full">
              <div className={cn("w-16 h-16 rounded-full blur-3xl absolute -top-4 -right-4", item.color === 'text-blue-600' ? "bg-blue-600/10" : "bg-emerald-600/10")}></div>
            </div>
            
            <div className="flex items-center justify-between mb-8">
              <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center transition-all group-hover:rotate-12 group-hover:scale-110 shadow-sm", 
                item.color === 'text-blue-600' ? "bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]" : 
                item.color === 'text-emerald-600' ? "bg-emerald-500/10 text-emerald-500" :
                item.color === 'text-rose-600' ? "bg-rose-500/10 text-rose-500" :
                "bg-[var(--theme-status)]"
              )}>
                {item.icon}
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-1.5">{item.label}</p>
                <div className="flex items-center justify-end">
                  <span className={cn("text-3xl font-black tracking-tighter tabular-nums", item.color)}>{item.val}</span>
                  {item.extra}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 pt-6 border-t border-slate-50">
              <div className={cn("w-2 h-2 rounded-full animate-pulse", item.color === 'text-blue-600' ? "bg-blue-600" : "bg-green-500")}></div>
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{item.sub}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Real-Time Operational Map */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-2 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl flex items-center justify-center border shadow-sm transition-transform hover:rotate-6 shrink-0" style={{ backgroundColor: 'var(--theme-status)', borderColor: 'var(--theme-border)', color: 'var(--theme-accent)' }}>
              <Globe size={20} md={24} />
            </div>
            <div>
              <h2 className="text-[12px] md:text-[14px] font-black text-[var(--theme-text)] uppercase tracking-[0.2em]">Live Tactical Deployment</h2>
              <p className="text-[8px] md:text-[10px] text-[var(--theme-text-muted)] uppercase font-bold tracking-widest leading-tight">Personnel telemetry across MLN & Hassi Messaoud</p>
            </div>
          </div>
          <div className="flex items-center gap-3 md:gap-5 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-full px-4 md:px-6 py-2 shadow-sm w-fit">
             <div className="flex items-center gap-2">
                <div className="w-2 md:w-2.5 h-2 md:h-2.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.3)]"></div>
                <span className="text-[8px] md:text-[9px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest">Secure Mesh Active</span>
             </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 gap-6 items-stretch">
          <div className="w-full">
            <PersonnelMap 
              onDutyPersonnel={personnel.filter(p => {
                 const matchesGroup = selectedGroup === 'ALL' || p.rosterGroup === selectedGroup;
                 const matchesCompany = selectedCompany === 'ALL' || p.company === selectedCompany;
                 if (!matchesGroup || !matchesCompany) return false;
                 const now = new Date();
                 now.setHours(0,0,0,0);
                 return schedules.some(s => {
                   const start = toDate(s.startDate);
                   const end = toDate(s.endDate);
                   if (!start || !end) return false;
                   return s.personnelId === p.id && 
                          s.status === 'ON_DUTY' && 
                          now >= start && 
                          now <= end;
                 });
              })} 
            />
          </div>
        </div>
      </motion.div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar: Events */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          {/* Compact Hub Events */}
          <div className="theme-container p-6 bg-[var(--theme-card)] border-[var(--theme-border)] flex-1 flex flex-col min-h-[350px] shadow-sm">
          <div className="flex items-center justify-between mb-6 shrink-0">
               <div className="flex items-center gap-3">
                 <div className="p-2 bg-[var(--theme-status)] rounded-lg">
                    <Tag className="text-emerald-600" size={16} />
                 </div>
                 <h3 className="text-[12px] font-black uppercase tracking-widest text-[var(--theme-text)]">Hub Events</h3>
               </div>
               <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 uppercase border border-emerald-100"> ON DUTY</span>
          </div>
            
          <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-1 max-h-[300px]">
              {upcomingEvents.length > 0 ? (
                upcomingEvents.map(ev => (
                  <div key={ev.id} className="p-4 rounded-2xl bg-[var(--theme-status)] border border-[var(--theme-border)] group hover:border-emerald-200 hover:bg-[var(--theme-card)] hover:shadow-lg hover:shadow-emerald-900/5 transition-all">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-1.5 bg-white rounded-lg shadow-sm border border-slate-50">
                          {getEventIcon(ev.type, 12)}
                        </div>
                        <span className="text-[11px] font-black text-slate-800 uppercase truncate" title={ev.title}>{ev.title}</span>
                      </div>
                      <span className="text-[9px] font-mono font-bold text-[var(--theme-text-muted)] uppercase bg-[var(--theme-card)] px-2 py-0.5 rounded-lg border border-[var(--theme-border)] shrink-0 shadow-sm">{ev.type}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-slate-500">
                        <Globe size={11} className="text-slate-400" />
                        <span className="text-[10px] font-black uppercase tracking-tight text-slate-400">{ev.location || 'MLN'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-[10px] text-slate-400 font-mono font-bold italic">
                          {ev.startDate === ev.endDate ? formatDate(ev.startDate) : `${formatDate(ev.startDate)} - ${formatDate(ev.endDate)}`}
                        </p>
                        {getDaysUntil(ev.startDate) <= 0 && getDaysUntil(ev.endDate) >= 0 && (
                          <div className="flex items-center gap-1.5">
                            <span className="block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-[9px] font-black text-green-600 uppercase">Current</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-10 text-center opacity-40">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">No events scheduled</p>
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
          <div className="theme-container overflow-visible p-0 flex flex-col xl:flex-row bg-white min-h-[350px] shadow-sm">
            {/* Left: Rotation Matrix (Compact Width) */}
            <div className="w-full xl:w-[40%] p-6 border-b xl:border-b-0 xl:border-r border-slate-100 bg-slate-50/30 flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--theme-status)' }}>
                    <LayoutGrid style={{ color: 'var(--theme-accent)' }} size={16} />
                  </div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--theme-text)]">Rotation Matrix</h3>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-white border border-slate-100 shadow-sm rounded-full">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]"></div>
                  <span className="text-[9px] text-slate-400 font-black uppercase tracking-tighter">Live deployment</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 flex-1">
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
                  const colorClass = status === 'ON_DUTY' ? 'emerald' : status === 'IN_TRANSIT' ? 'blue' : 'slate';

                  return (
                    <div key={group} className="group/rotation relative">
                      <div className={cn("p-4 rounded-2xl border transition-all hover:shadow-xl hover:shadow-slate-200/50 hover:bg-white cursor-pointer", 
                        status === 'ON_DUTY' ? "bg-emerald-50 border-emerald-100" : status === 'IN_TRANSIT' ? "bg-blue-50 border-blue-100" : "bg-slate-50 border-slate-100"
                      )}>
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-[13px] font-black text-[#0F172A] group-hover:text-blue-600 transition-colors">{group.startsWith('Group') ? group : `Group ${group}`}</span>
                          <div className={cn("w-2 h-2 rounded-full", 
                            status === 'ON_DUTY' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : status === 'IN_TRANSIT' ? "bg-blue-500" : "bg-slate-300"
                          )}></div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex -space-x-2">
                            {members.slice(0, 3).map((p, i) => (
                              <div key={p.id} className="w-8 h-8 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[10px] text-slate-800 font-black uppercase ring-2 ring-slate-50/50">
                                {p.fullName.charAt(0)}
                              </div>
                            ))}
                            {members.length > 3 && (
                              <div className="w-8 h-8 rounded-full border-2 border-white bg-blue-600 flex items-center justify-center text-[10px] text-white font-black uppercase ring-2 ring-slate-50/50">
                                +{members.length - 3}
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] font-mono font-black text-slate-400">{members.length} PAX</span>
                        </div>
                      </div>

                      {/* Tooltip */}
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+8px)] w-64 bg-white border border-slate-100 p-4 rounded-2xl shadow-2xl opacity-0 group-hover/rotation:opacity-100 invisible group-hover/rotation:visible transition-all z-50 pointer-events-none">
                        <div className="flex items-center justify-between mb-3 border-b border-slate-50 pb-2">
                          <p className="text-[10px] font-black text-[#0F172A] uppercase tracking-widest">{group} Manifest</p>
                          <span className="text-[9px] font-mono font-black text-blue-600">{members.length} Total</span>
                        </div>
                        <div className="space-y-3 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                          {members.map(m => {
                            const mSched = schedules.find(s => {
                              const start = toDate(s.startDate);
                              const end = toDate(s.endDate);
                              return m.id === s.personnelId && 
                                     new Date().setHours(0,0,0,0) >= (start?.setHours(0,0,0,0) || 0) && 
                                     new Date().setHours(0,0,0,0) <= (end?.setHours(0,0,0,0) || 0);
                            });
                            return (
                              <div key={m.id} className="flex items-center justify-between">
                                <span className="text-[10px] font-black text-slate-700 truncate max-w-[120px]">{m.fullName}</span>
                                <span className={cn(
                                  "text-[8px] font-black uppercase tracking-tighter",
                                  mSched?.status === 'ON_DUTY' ? "text-green-600" :
                                  mSched?.status === 'TRANSIT' ? "text-blue-600" : "text-slate-400"
                                )}>
                                  {mSched?.status || 'OFF DUTY'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Pulse Analytics */}
            <div className="flex-1 p-6 flex flex-col bg-[var(--theme-card)]">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--theme-status)' }}>
                    <Plane style={{ color: 'var(--theme-accent)' }} size={16} />
                  </div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--theme-text)]">Logistics Pulse</h3>
                </div>
                <div className="flex gap-4">
                   <div className="flex items-center gap-2">
                      <div className="w-3 h-1.5 rounded-full bg-blue-600 shadow-sm"></div>
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-tight">Algeria → Indo</span>
                   </div>
                   <div className="flex items-center gap-2">
                      <div className="w-3 h-1.5 rounded-full bg-emerald-600 shadow-sm"></div>
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-tight">Indo → Algeria</span>
                   </div>
                </div>
              </div>

              <div className="flex-1 min-h-[160px] mb-6">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[...availableMonths].sort().map(m => ({
                    month: formatPeriod(m),
                    dz_id: allFlights.filter(f => f.requestedDateDZtoID?.startsWith(m)).length,
                    id_dz: allFlights.filter(f => f.requestedDateIDtoDZ?.startsWith(m)).length,
                  })).slice(0, 12)}>
                    <defs>
                      <linearGradient id="colorDz" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563EB" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#2563EB" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorId" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                    <XAxis 
                      dataKey="month" 
                      stroke="#94A3B8" 
                      fontSize={9} 
                      fontWeight={900}
                      tickLine={false} 
                      axisLine={false}
                      interval={0}
                      dy={10}
                    />
                    <YAxis hide />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #F1F5F9', borderRadius: '12px', fontSize: '11px', fontWeight: 900, boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                      itemStyle={{ color: '#0F172A' }}
                    />
                    <Area type="monotone" dataKey="dz_id" stroke="#2563EB" fillOpacity={1} fill="url(#colorDz)" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, strokeWidth: 0 }} />
                    <Area type="monotone" dataKey="id_dz" stroke="#10B981" fillOpacity={1} fill="url(#colorId)" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-100">
                <div className="p-4 bg-[var(--theme-status)] rounded-2xl border border-[var(--theme-border)] shadow-sm transition-transform hover:scale-105">
                  <p className="text-[10px] text-[var(--theme-text-muted)] font-extrabold uppercase mb-2 tracking-widest">Yearly Volume</p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-mono text-[var(--theme-text)] font-black tabular-nums tracking-tighter">
                      {allFlights.filter(f => {
                         const yr = new Date().getFullYear().toString();
                         return f.requestedDateDZtoID?.startsWith(yr) || f.requestedDateIDtoDZ?.startsWith(yr);
                      }).length}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest uppercase" style={{ color: 'var(--theme-accent)' }}>Flights</span>
                  </div>
                </div>
                <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 shadow-sm transition-transform hover:scale-105 group/card relative">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-blue-400 font-extrabold uppercase tracking-widest">Pipeline Health</p>
                    <div className="group/tooltip relative">
                      <Info size={12} className="text-blue-300 cursor-help" />
                      <div className="absolute right-0 bottom-full mb-2 w-64 bg-[var(--theme-card)] border border-[var(--theme-border)] p-4 rounded-3xl shadow-2xl opacity-0 group-hover/tooltip:opacity-100 invisible group-hover/tooltip:visible transition-all z-50 pointer-events-none">
                        <p className="text-[10px] font-black text-[var(--theme-text)] uppercase mb-4 border-b border-[var(--theme-border)] pb-2">Pipeline System Integrity</p>
                        <p className="text-[9px] text-[var(--theme-text-muted)] font-bold uppercase leading-relaxed mb-4">
                          Pipeline Health evaluates logistics efficiency by mapping booking fulfillment rates against requested operational dates.
                        </p>
                        <div className="space-y-3 text-[9px]">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                            <span className="text-[var(--theme-text-muted)]"><span className="text-emerald-700 font-black">OPTIMAL:</span> &gt; 90% fulfillment, &lt; 24h lag</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]" />
                            <span className="text-[var(--theme-text-muted)]"><span className="text-amber-700 font-black">SUBOPTIMAL:</span> 75-90% fulfillment, 24-48h lag</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]" />
                            <span className="text-[var(--theme-text-muted)]"><span className="text-rose-700 font-black">CRITICAL:</span> &lt; 75% fulfillment, &gt; 48h lag</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className={cn(
                      "text-3xl font-mono font-black tabular-nums tracking-tighter",
                      stats.healthCategory === 'Optimal' ? "text-blue-700" : 
                      stats.healthCategory === 'Suboptimal' ? "text-amber-700" : "text-rose-700"
                    )}>
                      {stats.monthlyFulfillment}%
                    </span>
                    <span className={cn(
                      "text-[10px] font-black uppercase tracking-widest",
                      stats.healthCategory === 'Optimal' ? "text-blue-500" : 
                      stats.healthCategory === 'Suboptimal' ? "text-amber-500" : "text-rose-500"
                    )}>
                      MONTHLY
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 pt-2 border-t border-blue-100/50">
                    <span className="text-sm font-mono font-black text-blue-600">
                      {Math.round((allFlights.filter(f => (f.requestedDateDZtoID || f.requestedDateIDtoDZ)?.startsWith(new Date().getFullYear().toString()) && (f.statusDZtoID === 'Received' || f.statusIDtoDZ === 'Received')).length / Math.max(1, allFlights.filter(f => (f.requestedDateDZtoID || f.requestedDateIDtoDZ)?.startsWith(new Date().getFullYear().toString())).length)) * 100)}%
                    </span>
                    <span className="text-[8px] font-black text-blue-400 uppercase tracking-widest">YTD HEALTH</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* --- LABOR ANALYTICS SECTION --- */}
        <div className="lg:col-span-2 theme-container p-8 bg-white border border-slate-100 relative overflow-hidden group shadow-sm hover:shadow-2xl hover:shadow-blue-900/5 transition-all">
          {/* Subtle Background Glow */}
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-[var(--theme-status)] rounded-lg">
                    <Activity size={18} className="text-blue-600" />
                  </div>
                  <h3 className="text-sm font-black text-[var(--theme-text)] uppercase tracking-[0.2em]">Labor Force Profile</h3>
                </div>
                <p className="text-[9px] md:text-[10px] text-[var(--theme-text-muted)] uppercase font-black tracking-widest">Personnel Deployment vs Cumulative Workflow (12h Benchmark)</p>
              </div>

              {/* Selection Tabs */}
              <div className="flex bg-slate-50 p-1 rounded-2xl border border-slate-100 mb-0">
                <button
                  onClick={() => setLaborProfileTab('individual')}
                  className={cn(
                    "px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                    laborProfileTab === 'individual' 
                      ? "bg-white text-blue-600 shadow-sm border border-slate-100" 
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  Individual Metrics
                </button>
                <button
                  onClick={() => setLaborProfileTab('monthly')}
                  className={cn(
                    "px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                    laborProfileTab === 'monthly' 
                      ? "bg-white text-blue-600 shadow-sm border border-slate-100" 
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  Monthly Trends
                </button>
                <button
                  onClick={() => setLaborProfileTab('work-hours')}
                  className={cn(
                    "px-6 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                    laborProfileTab === 'work-hours' 
                      ? "bg-white text-blue-600 shadow-sm border border-slate-100" 
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  Working Hours
                </button>
              </div>
              
              <div className="flex flex-wrap items-center gap-2 md:gap-4 w-full sm:w-auto">
                {/* Group Filter */}
                <div className="relative flex items-center justify-center w-10 h-10 md:w-auto md:h-auto md:px-4 py-2 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl group/filter hover:bg-[var(--theme-card)] hover:shadow-lg transition-all shadow-sm flex-none">
                  <span className="hidden md:block text-[9px] md:text-[10px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest mr-2">Filter:</span>
                  <Filter size={12} className="md:hidden text-[var(--theme-text-muted)]" />
                  <select 
                    value={selectedGroup} 
                    onChange={(e) => {
                      setSelectedGroup(e.target.value);
                      setSelectedPersonnel('ALL');
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer md:relative md:opacity-100 md:bg-transparent md:text-[10px] md:text-[11px] md:font-black md:text-[var(--theme-text)] md:focus:outline-none md:uppercase md:w-auto"
                  >
                    <option value="ALL">All Groups</option>
                    {uniqueGroups.map(g => <option key={g} value={g} className="bg-white">{g}</option>)}
                  </select>
                </div>

                {/* Company Filter */}
                <div className="relative flex items-center justify-center w-10 h-10 md:w-auto md:h-auto md:px-4 py-2 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl group/filter hover:bg-[var(--theme-card)] hover:shadow-lg transition-all shadow-sm flex-none">
                  <span className="hidden md:block text-[9px] md:text-[10px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest mr-2">Company:</span>
                  <Briefcase size={12} className="md:hidden text-[var(--theme-text-muted)]" />
                  <select 
                    value={selectedCompany} 
                    onChange={(e) => {
                      setSelectedCompany(e.target.value);
                      setSelectedPersonnel('ALL');
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer md:relative md:opacity-100 md:bg-transparent md:text-[10px] md:text-[11px] md:font-black md:text-[var(--theme-text)] md:focus:outline-none md:uppercase md:w-auto select-none"
                  >
                    <option value="ALL">All Companies</option>
                    {uniqueCompanies.map(c => <option key={c} value={c} className="bg-white">{c}</option>)}
                  </select>
                </div>

                {/* Personnel Selector */}
                <div className="relative flex items-center justify-center w-10 h-10 md:w-auto md:h-auto md:px-4 py-2 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl group/filter hover:bg-[var(--theme-card)] hover:shadow-lg transition-all shadow-sm flex-none">
                  <span className="hidden md:block text-[9px] md:text-[10px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest mr-2">Personnel:</span>
                  <Users size={12} className="md:hidden text-[var(--theme-text-muted)]" />
                  <select 
                    value={selectedPersonnel} 
                    onChange={(e) => setSelectedPersonnel(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer md:relative md:opacity-100 md:bg-transparent md:text-[10px] md:text-[11px] md:font-black md:text-[var(--theme-text)] md:focus:outline-none md:uppercase md:w-auto select-none"
                  >
                    <option value="ALL">All Personnel</option>
                    {personnel
                      .filter(p => {
                        const matchesGroup = selectedGroup === 'ALL' || p.rosterGroup === selectedGroup;
                        const matchesCompany = selectedCompany === 'ALL' || p.company === selectedCompany;
                        return matchesGroup && matchesCompany;
                      })
                      .map(p => <option key={p.id} value={p.id} className="bg-white">{p.fullName}</option>)
                    }
                  </select>
                </div>

                {/* Download Button */}
                <button
                  onClick={exportOnDutyDays}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] md:text-[11px] font-black uppercase tracking-widest shadow-sm transition-all flex-none select-none"
                  title="Download On Duty Days for selected filters and months"
                >
                  <Download size={13} />
                  <span className="hidden sm:inline">Download Duty Days</span>
                </button>

                {/* Period Selector */}
                <div className="relative flex-1 sm:flex-none">
                  <button 
                    onClick={() => setIsPeriodMenuOpen(!isPeriodMenuOpen)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl shadow-sm hover:bg-white hover:shadow-lg transition-all w-full",
                      isPeriodMenuOpen && "ring-2 ring-blue-500/20 bg-white"
                    )}
                  >
                    <Calendar size={14} className={cn("transition-colors", isPeriodMenuOpen ? "text-blue-600" : "text-slate-400")} />
                    <span className="text-[10px] md:text-[11px] font-black text-[#0F172A] uppercase tracking-widest min-w-[70px] text-left">
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
                      
                      <div className="absolute top-full right-0 mt-3 w-64 bg-white border border-slate-100 rounded-[1.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] z-50 overflow-hidden animate-in fade-in zoom-in duration-300">
                        <div className="p-4 border-b border-slate-50 bg-slate-50/50">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Temporal Selection</p>
                        </div>
                        <div className="max-h-72 overflow-y-auto custom-scrollbar p-1">
                          <div 
                            onClick={() => {
                              setSelectedPeriods([]);
                              setIsPeriodMenuOpen(false); // Close on lifetime selection as it's a "reset"
                            }}
                            className={cn(
                              "m-1 px-4 py-3 text-[11px] font-black uppercase cursor-pointer rounded-xl transition-all hover:bg-blue-50 flex items-center justify-between",
                              selectedPeriods.length === 0 ? "text-blue-600 bg-blue-50" : "text-slate-400"
                            )}
                          >
                            <span>LIFETIME ANALYTICS</span>
                            {selectedPeriods.length === 0 && <CheckCircle2 size={14} />}
                          </div>
                          {availableMonths.map(m => {
                            const isSelected = selectedPeriods.includes(m);
                            return (
                              <div 
                                key={m}
                                onClick={() => togglePeriod(m)}
                                className={cn(
                                  "m-1 px-4 py-3 text-[11px] font-black uppercase cursor-pointer rounded-xl transition-all flex items-center justify-between hover:bg-blue-50",
                                  isSelected ? "text-blue-600 bg-blue-50" : "text-slate-400"
                                )}
                              >
                                <span>{formatPeriod(m)}</span>
                                {isSelected && <CheckCircle2 size={14} />}
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

            <div className="flex-1 relative">
              {laborProfileTab !== 'individual' && (
                <div className="absolute top-4 right-4 z-20 flex flex-col gap-3 pointer-events-none">
                  <div className="bg-white/80 backdrop-blur-xl border border-slate-100 p-4 md:p-6 rounded-3xl text-left md:text-right flex flex-row md:flex-col gap-6 md:gap-4 shadow-[0_20px_50px_rgba(0,0,0,0.05)] pointer-events-auto">
                    <div className="flex-1 md:flex-none">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Period Total</p>
                      <p className="text-2xl md:text-3xl font-mono font-black text-[#0F172A]">{laborAnalytics.totalHours.toLocaleString()}<span className="text-[10px] text-blue-600 ml-1">HRS</span></p>
                    </div>
                    <div className="pt-0 md:pt-4 border-l md:border-l-0 md:border-t border-slate-100 md:border-slate-50 pl-6 md:pl-0 flex-1 md:flex-none">
                      <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Year-to-Date</p>
                      <p className="text-xl font-mono font-black text-emerald-700">{laborAnalytics.ytdHours.toLocaleString()}<span className="text-[10px] text-emerald-500 ml-1">HRS</span></p>
                    </div>
                  </div>
                </div>
              )}

              {laborProfileTab === 'individual' ? (
                <div className="h-[450px] w-full pt-10">
                  {laborAnalytics.chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart 
                        data={laborAnalytics.chartData} 
                        margin={{ top: 20, right: 30, left: 10, bottom: 80 }}
                        barGap={0}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                        <XAxis 
                          dataKey="name" 
                          stroke="#94A3B8" 
                          fontSize={11} 
                          fontWeight="900" 
                          tickLine={false} 
                          axisLine={false} 
                          interval={0}
                          angle={-45}
                          textAnchor="end"
                          dy={10}
                        />
                        <YAxis 
                          stroke="#94A3B8" 
                          fontSize={10} 
                          fontWeight="900" 
                          tickLine={false} 
                          axisLine={false}
                          tickFormatter={(val) => `${val}h`}
                        />
                        <RechartsTooltip 
                          cursor={{ fill: '#F8FAFC' }}
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #F1F5F9', borderRadius: '12px', fontSize: '11px', fontWeight: 900, boxShadow: '0 10px 15px -10px rgba(0,0,0,0.1)' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white border border-slate-100 p-4 rounded-2xl shadow-xl">
                                  <p className="text-[10px] font-black text-[#0F172A] uppercase mb-1">{data.name}</p>
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: groupColorMap[data.group] || '#3b82f6' }} />
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{data.group}</p>
                                  </div>
                                  <p className="text-[16px] font-mono font-black text-blue-600">{data.hours.toLocaleString()} HR</p>
                                  <p className="text-[8px] text-slate-400 font-bold uppercase mt-1 tracking-tighter">Verified Operational Log</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar 
                          dataKey="hours" 
                          radius={[8, 8, 0, 0]} 
                          animationDuration={1500}
                        >
                          <LabelList 
                            dataKey="hours" 
                            position="top" 
                            fill="#94A3B8" 
                            fontSize={10} 
                            fontWeight="900"
                            formatter={(val: number) => val.toLocaleString()}
                          />
                          {laborAnalytics.chartData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={groupColorMap[entry.group] || '#3b82f6'} 
                              fillOpacity={0.9}
                              stroke={groupColorMap[entry.group] || '#3b82f6'}
                              strokeWidth={1}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-200 rounded-3xl group-hover:border-blue-500/20 transition-all">
                      <div className="relative">
                        <Activity size={64} className="text-slate-200 mb-4 animate-pulse" />
                        <AlertCircle size={20} className="absolute -top-2 -right-2 text-rose-500/20" />
                      </div>
                      <h4 className="text-[14px] font-black text-slate-300 uppercase tracking-[0.3em]">No Deployment Matrix</h4>
                      <p className="text-[10px] text-slate-400 font-black uppercase mt-2 tracking-widest">Awaiting rotational synchronization</p>
                    </div>
                  )}
                </div>
              ) : laborProfileTab === 'monthly' ? (
                <div className="h-[450px] w-full pt-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={laborAnalytics.monthlyTrends} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                      <defs>
                        {uniqueGroups.filter(g => g !== 'ALL').map(group => (
                          <linearGradient key={`color${sanitizeId(group)}`} id={`color${sanitizeId(group)}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={groupColorMap[group] || '#3b82f6'} stopOpacity={0.4}/>
                            <stop offset="95%" stopColor={groupColorMap[group] || '#3b82f6'} stopOpacity={0}/>
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                      <XAxis 
                        dataKey="month" 
                        stroke="#94A3B8" 
                        fontSize={10} 
                        fontWeight={900}
                        tickLine={false} 
                        axisLine={false}
                        interval={0}
                        dy={10}
                      />
                      <YAxis 
                        stroke="#94A3B8" 
                        fontSize={10} 
                        fontWeight={900}
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(val) => `${val}h`}
                      />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#fff', border: 'none', borderRadius: '16px', fontSize: '11px', fontWeight: 900, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                             const data = payload[0].payload;
                             return (
                               <div className="bg-white border border-slate-50 p-5 rounded-[2rem] shadow-2xl min-w-[200px]">
                                 <div className="flex items-center justify-between mb-4 border-b border-slate-50 pb-3">
                                   <p className="text-[12px] font-black text-[#0F172A] uppercase tracking-widest">{label}</p>
                                   <p className="text-[9px] font-mono font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full">{data.total.toLocaleString()} HR</p>
                                 </div>
                                 <div className="space-y-3">
                                   {uniqueGroups.filter(g => g !== 'ALL' && data[g] > 0).map(g => (
                                     <div key={g} className="flex items-center justify-between gap-6">
                                       <div className="flex items-center gap-3">
                                         <div className="w-2 h-2 rounded-full" style={{ backgroundColor: groupColorMap[g] || '#3b82f6' }} />
                                         <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{g}</span>
                                       </div>
                                       <span className="text-[10px] font-mono font-black text-[#0F172A]">{data[g].toLocaleString()} HR</span>
                                     </div>
                                   ))}
                                 </div>
                               </div>
                             );
                          }
                          return null;
                        }}
                      />
                      {uniqueGroups.filter(g => g !== 'ALL').map((group, idx) => (
                        <Area 
                          key={group}
                          type="monotone" 
                          stackId="1"
                          dataKey={group} 
                          stroke={groupColorMap[group] || COLORS[idx % COLORS.length]} 
                          fillOpacity={1} 
                          fill={`url(#color${sanitizeId(group)})`} 
                          strokeWidth={3} 
                          dot={false}
                          activeDot={{ r: 6, strokeWidth: 0 }} 
                          animationDuration={2000}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[450px] w-full pt-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={laborAnalytics.monthlyTrends} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                      <defs>
                        <linearGradient id="colorPulseHours" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                      <XAxis 
                        dataKey="month" 
                        stroke="#94A3B8" 
                        fontSize={10} 
                        fontWeight={900}
                        tickLine={false} 
                        axisLine={false}
                        interval={0}
                        dy={10}
                      />
                      <YAxis hide />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #F1F5F9', borderRadius: '20px', fontSize: '11px', fontWeight: 900, boxShadow: '0 20px 40px -10px rgba(0,0,0,0.1)', padding: '16px' }}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="space-y-2">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{data.month}</p>
                                <p className="text-xl font-mono font-black text-blue-600">{data.total.toLocaleString()} HR</p>
                                <p className="text-[8px] text-slate-400 font-bold uppercase tracking-tight">Total Monthly Operational Hours</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="total" 
                        stroke="#3b82f6" 
                        fillOpacity={1} 
                        fill="url(#colorPulseHours)" 
                        strokeWidth={4} 
                        dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#3b82f6' }}
                        activeDot={{ r: 8, strokeWidth: 2, fill: '#fff', stroke: '#3b82f6' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Personnel Status Manifest */}
        <div className="theme-card p-8 flex flex-col h-[650px] shadow-sm hover:shadow-2xl hover:shadow-blue-900/5 transition-all">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Users size={18} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-[var(--theme-text)] uppercase tracking-widest">Live Manifest</h3>
                <p className="text-[10px] text-[var(--theme-text-muted)] font-extrabold uppercase mt-1 tracking-widest">Real-time presence</p>
              </div>
            </div>
          </div>
          
          <div className="space-y-3 overflow-y-auto custom-scrollbar pr-3 flex-1">
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
               
               let daysRemainingText = '';
               if (isOnDuty && activeSched) {
                 const endDate = toDate(activeSched.endDate);
                 if (endDate) {
                   endDate.setHours(0,0,0,0);
                   const diff = endDate.getTime() - now.getTime();
                   const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
                   daysRemainingText = `${days} Remaining Days`;
                 }
               }

               return { p, isOnDuty, isTransit, daysRemainingText };
            })
            .sort((a,b) => {
              if (a.isOnDuty && !b.isOnDuty) return -1;
              if (!a.isOnDuty && b.isOnDuty) return 1;
              return 0;
            })
            .map(({ p, isOnDuty, isTransit, daysRemainingText }) => (
              <div key={p.id} className="flex items-center justify-between p-4 rounded-2xl bg-[var(--theme-container)] border border-[var(--theme-border)] hover:bg-[var(--theme-card)] hover:shadow-lg hover:shadow-black/5 transition-all group">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full transition-all duration-500",
                    isOnDuty ? "bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)] animate-pulse" : isTransit ? "bg-blue-400" : "bg-slate-200"
                  )} />
                  <div>
                    <p className="text-[12px] font-black text-[var(--theme-text)] uppercase tracking-tighter truncate group-hover:text-blue-600 transition-colors">{p.fullName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{p.rosterGroup}</span>
                      {daysRemainingText && (
                        <>
                          <span className="text-[8px] text-slate-300">•</span>
                          <p className={cn(
                            "text-[9px] font-mono font-bold uppercase tracking-widest",
                            isOnDuty ? "text-green-600" : "text-[var(--theme-text-muted)]"
                          )}>
                            {daysRemainingText}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className={cn(
                  "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border",
                  isOnDuty ? "bg-emerald-50 text-emerald-700 border-emerald-200" : 
                  isTransit ? "bg-blue-50 text-blue-700 border-blue-200" : 
                  "bg-[var(--theme-status)] text-[var(--theme-text-muted)] border-[var(--theme-border)]"
                )}>
                  {isOnDuty ? ' ON DUTY' : isTransit ? 'TRANSIT' : 'OFF DUTY'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Logistics Intelligence Row */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Fulfillment Sync (Pie Chart) */}
        <div className="lg:col-span-1 theme-container p-8 shadow-sm hover:shadow-2xl hover:shadow-blue-900/5 transition-all group/fulfillment">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-50 rounded-lg group-hover/fulfillment:rotate-12 transition-transform">
                <CheckCircle2 size={18} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-[var(--theme-text)] uppercase tracking-[0.1em]">Fulfillment Sync</h3>
                <p className="text-[10px] text-[var(--theme-text-muted)] font-black uppercase mt-1 tracking-widest">Efficiency Matrix</p>
              </div>
            </div>
          </div>
          <div className="h-[200px] w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={statusData} 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={65} 
                  outerRadius={85} 
                  paddingAngle={8}
                  dataKey="value"
                  stroke="none"
                >
                  {statusData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={statusColorMap[entry.name] || COLORS[index % COLORS.length]} 
                      className="hover:opacity-80 transition-opacity cursor-pointer"
                    />
                  ))}
                </Pie>
                <RechartsTooltip 
                   contentStyle={{ backgroundColor: 'var(--theme-card)', border: '1px solid var(--theme-border)', borderRadius: '12px', fontSize: '11px', fontWeight: 900, boxShadow: 'var(--theme-shadow)' }}
                   itemStyle={{ color: 'var(--theme-text)' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-[10px] text-[var(--theme-text-muted)] font-black uppercase tracking-widest leading-none">Sync</p>
                <p className="text-2xl font-mono font-black text-[var(--theme-text)] mt-1">100%</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-8">
             {statusData.slice(0, 4).map((item) => (
                <div key={item.name} className="flex flex-col p-4 bg-[var(--theme-container)] border border-[var(--theme-border)] rounded-2xl group/item hover:bg-[var(--theme-card)] hover:shadow-lg transition-all">
                   <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColorMap[item.name] || '#3b82f6' }} />
                      <span className="text-[9px] text-[var(--theme-text-muted)] font-black uppercase tracking-widest truncate">{item.name}</span>
                   </div>
                   <span className="text-xl text-[var(--theme-text)] font-mono font-black tabular-nums">{item.value}</span>
                </div>
             ))}
          </div>
        </div>

        {/* Awaiting Fulfillment (Feed) */}
        <div id="awaiting-ops-action" className="lg:col-span-2 theme-container p-8 flex flex-col shadow-sm hover:shadow-2xl hover:shadow-blue-900/5 transition-all group/awaiting">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-50 rounded-lg group-hover/awaiting:scale-110 transition-transform">
                <Clock size={18} className="text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-[var(--theme-text)] uppercase tracking-[0.1em]">Awaiting Ops Action</h3>
                <p className="text-[9px] md:text-[10px] text-[var(--theme-text-muted)] font-black uppercase mt-1 tracking-widest">High-Priority Queue</p>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <button 
                onClick={() => copyAsImage('awaiting-ops-action')}
                className="p-2.5 md:p-3 rounded-xl md:rounded-2xl bg-[var(--theme-status)] border border-[var(--theme-border)] hover:bg-[var(--theme-card)] hover:shadow-xl transition-all text-[var(--theme-text-muted)] hover:text-blue-600 shadow-sm"
                title="Copy Dispatch Matrix"
              >
                {copying === 'awaiting-ops-action' ? <Check size={18} /> : <Copy size={18} />}
              </button>
              <div className="px-3 md:px-4 py-1.5 bg-rose-50 text-rose-600 text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] rounded-full border border-rose-100">Live Queue</div>
            </div>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-3 max-h-[380px]">
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
                   <div 
                      key={f.id} 
                      onClick={() => setSelectedAwaitingItem({ flight: f, person })}
                      className="p-4 md:p-5 rounded-2xl md:rounded-[2rem] bg-[#F8FAFC] border border-slate-100 flex flex-col items-start sm:flex-row sm:items-center justify-between gap-4 group hover:border-blue-200 hover:bg-white hover:shadow-xl hover:shadow-blue-900/5 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-4 md:gap-5">
                         <div className="w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-white shadow-lg border border-slate-50 flex items-center justify-center text-[14px] md:text-[18px] font-black text-blue-600 transition-transform group-hover:rotate-6">
                            {person?.fullName.charAt(0)}
                         </div>
                         <div>
                            <p className="text-[12px] md:text-[14px] text-[#0F172A] font-black uppercase leading-tight tracking-tight">{person?.fullName}</p>
                            <p className="text-[8px] md:text-[10px] text-slate-400 font-mono font-bold mt-1 uppercase tracking-widest">TXN-{f.id.slice(0,8).toUpperCase()}</p>
                         </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 md:gap-8 w-full sm:w-auto">
                         {f.requestedDateDZtoID && f.statusDZtoID === 'Requested' && (
                           <div className="text-left sm:text-right flex-1 sm:flex-none">
                             <div className="flex items-center sm:justify-end gap-2 mb-1">
                                <span className="block w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                <p className="text-[8px] md:text-[10px] font-black text-blue-600 uppercase tracking-widest">ALG → JKT</p>
                             </div>
                             <p className="text-[11px] md:text-[13px] text-[#0F172A] font-mono font-black tabular-nums">{formatDate(f.requestedDateDZtoID)}</p>
                             <p className="text-[8px] md:text-[10px] text-slate-400 font-extrabold uppercase mt-1 tracking-widest">
                               {getDaysUntil(f.requestedDateDZtoID) === 0 ? 'DUE TODAY' : 
                                getDaysUntil(f.requestedDateDZtoID) < 0 ? 'OVERDUE' : 
                                `${getDaysUntil(f.requestedDateDZtoID)}d Lead`}
                             </p>
                           </div>
                         )}
                         {f.requestedDateIDtoDZ && f.statusIDtoDZ === 'Requested' && (
                           <div className="text-left sm:text-right flex-1 sm:flex-none">
                             <div className="flex items-center sm:justify-end gap-2 mb-1">
                                <span className="block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                <p className="text-[8px] md:text-[10px] font-black text-emerald-600 uppercase tracking-widest">JKT → ALG</p>
                             </div>
                             <p className="text-[11px] md:text-[13px] text-[#0F172A] font-mono font-black tabular-nums">{formatDate(f.requestedDateIDtoDZ)}</p>
                             <p className="text-[8px] md:text-[10px] text-slate-400 font-extrabold uppercase mt-1 tracking-widest">
                               {getDaysUntil(f.requestedDateIDtoDZ) === 0 ? 'DUE TODAY' : 
                                getDaysUntil(f.requestedDateIDtoDZ) < 0 ? 'OVERDUE' : 
                                `${getDaysUntil(f.requestedDateIDtoDZ)}d Lead`}
                             </p>
                           </div>
                         )}
                         <div className="p-1.5 md:p-2 bg-white rounded-lg md:rounded-xl shadow-sm border border-slate-50 group-hover:translate-x-1 transition-all hidden sm:block">
                            <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-600 transition-colors" />
                         </div>
                      </div>
                   </div>
                );
             })}
             {allFlights.filter(f => f.statusDZtoID === 'Requested' || f.statusIDtoDZ === 'Requested').length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center py-20 bg-slate-50/50 rounded-[3rem] border border-dashed border-slate-100">
                   <div className="p-6 bg-white rounded-[2rem] shadow-2xl border border-slate-50 mb-6 group-hover:scale-110 transition-transform">
                      <CheckCircle2 size={48} className="text-emerald-500" />
                   </div>
                   <h4 className="text-[16px] font-black text-slate-900 uppercase tracking-[0.4em]">Queue Purged</h4>
                   <p className="text-[10px] text-slate-400 font-black uppercase mt-2 tracking-widest">All operational actions complete</p>
                </div>
             )}
          </div>
        </div>

        {/* Allocation Progress (Group Balance) */}
        <div className="lg:col-span-1 theme-container p-8 bg-white border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-blue-900/5 transition-all group/allocation">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-50 rounded-lg group-hover/allocation:rotate-12 transition-transform">
                <LayoutGrid size={18} className="text-orange-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-[0.1em]">Group Balance</h3>
                <p className="text-[10px] text-slate-400 font-black uppercase mt-1 tracking-widest">Distribution</p>
              </div>
            </div>
          </div>
          <div className="space-y-6">
             {uniqueGroups.slice(0, 6).map((g) => {
               const groupPersonnel = personnel.filter(p => p.rosterGroup === g);
               const percent = stats.totalPersonnel ? Math.round((groupPersonnel.length / stats.totalPersonnel) * 100) : 0;
               return (
                 <div key={g} className="group/item">
                   <div className="flex justify-between items-baseline mb-2">
                     <span className="text-[11px] font-black text-slate-800 uppercase tracking-widest group-hover/item:text-blue-600 transition-colors">{g}</span>
                     <span className="text-[10px] font-mono font-black text-slate-400 tabular-nums">{groupPersonnel.length} PAX</span>
                   </div>
                   <div className="h-3 bg-slate-50 rounded-full overflow-hidden border border-slate-100 p-0.5">
                     <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${percent}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="h-full bg-blue-600 rounded-full shadow-[0_0_10px_rgba(37,99,235,0.3)]" 
                     />
                   </div>
                 </div>
               );
             })}
          </div>
        </div>
      </div>

      {/* Flight Performance Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="theme-container p-6 md:p-8 bg-white border border-slate-100 relative overflow-hidden group shadow-sm hover:shadow-2xl hover:shadow-blue-900/5 transition-all mb-6"
      >
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-[var(--theme-status)] rounded-lg">
                  <Activity size={18} className="text-blue-600" />
                </div>
                <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-[0.2em]">Flight Performance</h3>
              </div>
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">30-Day Logistics & Fulfillment Trends</p>
            </div>
            
            <div className="flex items-center gap-4 bg-slate-50 border border-slate-100 rounded-2xl p-4 shadow-sm w-full sm:w-auto">
              <div className="flex-1 sm:flex-none">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Requests</p>
                <p className="text-xl font-mono font-black text-[#0F172A]">{performanceStats.totalRequests}<span className="text-[10px] text-blue-600 ml-1">LEGS</span></p>
              </div>
              <div className="h-8 w-[1px] bg-slate-200" />
              <div className="flex-1 sm:flex-none">
                <p className="text-[9px] font-black text-green-600 uppercase tracking-widest mb-1">Completed</p>
                <p className="text-xl font-mono font-black text-green-700">{performanceStats.totalCompleted}<span className="text-[10px] text-green-500 ml-1">OK</span></p>
              </div>
              <div className="h-8 w-[1px] bg-slate-200" />
              <div className="flex-1 sm:flex-none">
                <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1">Fulfillment</p>
                <p className="text-xl font-mono font-black text-blue-700">{performanceStats.completionRate}%</p>
              </div>
            </div>
          </div>

          <div className="h-[280px] w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={flightPerformanceData} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis 
                  dataKey="label" 
                  stroke="#94A3B8" 
                  fontSize={9} 
                  fontWeight={900}
                  tickLine={false} 
                  axisLine={false}
                  dy={10}
                />
                <YAxis 
                  stroke="#94A3B8" 
                  fontSize={9} 
                  fontWeight={900}
                  tickLine={false} 
                  axisLine={false}
                  allowDecimals={false}
                  dx={-5}
                />
                <RechartsTooltip 
                  contentStyle={{ 
                    backgroundColor: '#0F172A', 
                    border: 'none', 
                    borderRadius: '12px', 
                    fontSize: '11px', 
                    fontWeight: 900, 
                    color: '#fff',
                    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)' 
                  }}
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="requests" 
                  name="Total Requests" 
                  stroke="#2563EB" 
                  strokeWidth={3} 
                  dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} 
                  activeDot={{ r: 6, strokeWidth: 0 }} 
                />
                <Line 
                  type="monotone" 
                  dataKey="completed" 
                  name="Completed Flights" 
                  stroke="#10B981" 
                  strokeWidth={3} 
                  dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} 
                  activeDot={{ r: 6, strokeWidth: 0 }} 
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.div>

      {/* Manifest Row */}
      <div id="flight-requests-summary" className="theme-container bg-[var(--theme-card)] border border-[var(--theme-border)] overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-blue-900/5 transition-all">
        <div className="p-4 md:p-8 border-b border-[var(--theme-border)] flex flex-col xl:flex-row xl:items-center justify-between bg-[var(--theme-status)] gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
               <Plane size={18} className="text-blue-600" />
            </div>
            <div>
               <h2 className="text-sm font-black text-[#0F172A] uppercase tracking-widest">Flight Ticket Requests Summary</h2>
               <p className="text-[10px] text-slate-400 font-black uppercase mt-1 tracking-widest">Logistics Dispatch Audit</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 md:gap-3 w-full xl:w-auto">
             <div className="flex items-center bg-white border border-slate-100 rounded-xl p-1 shadow-sm mr-2 select-none">
                {(['Active', 'Completed'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setSummaryTab(tab)}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                      summaryTab === tab 
                        ? "bg-[#0F172A] text-white shadow-lg shadow-blue-900/10" 
                        : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    {tab === 'Active' ? 'Active Requests' : 'Completed Requests'}
                  </button>
                ))}
             </div>
             {/* Search/Filter Controls */}
             <div className="relative flex items-center justify-center w-10 md:w-auto md:h-auto md:px-4 py-2 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl text-[10px] shadow-sm flex-none">
                <Users size={12} className="text-[var(--theme-text-muted)]" />
                <select 
                  value={summaryGroup} 
                  onChange={(e) => {
                    setSummaryGroup(e.target.value);
                    setSummaryPersonnel('ALL');
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer md:relative md:opacity-100 md:bg-transparent md:text-[var(--theme-text)] md:focus:outline-none md:uppercase md:font-black md:tracking-tight md:ml-2 md:w-auto"
                >
                  <option value="ALL">All Groups</option>
                  {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <span className="hidden md:block ml-2 text-[var(--theme-text)] font-black uppercase tracking-tight">{summaryGroup === 'ALL' ? 'Groups' : summaryGroup}</span>
             </div>

             <div className="relative flex items-center justify-center w-10 md:w-auto md:h-auto md:px-4 py-2 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl text-[10px] shadow-sm flex-none">
                <Briefcase size={12} className="text-[var(--theme-text-muted)]" />
                <select 
                  value={summaryCompany} 
                  onChange={(e) => {
                    setSummaryCompany(e.target.value);
                    setSummaryPersonnel('ALL');
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer md:relative md:opacity-100 md:bg-transparent md:text-[var(--theme-text)] md:focus:outline-none md:uppercase md:font-black md:tracking-tight md:ml-2 md:w-auto"
                >
                  <option value="ALL">All Companies</option>
                  {uniqueCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="hidden md:block ml-2 text-[var(--theme-text)] font-black uppercase tracking-tight">{summaryCompany === 'ALL' ? 'Companies' : summaryCompany}</span>
              </div>

             <div className="relative flex items-center justify-center w-10 md:w-auto md:h-auto md:px-4 py-2 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl text-[10px] shadow-sm flex-none">
                <Users size={12} className="text-[var(--theme-text-muted)]" />
                <select 
                  value={summaryPersonnel} 
                  onChange={(e) => setSummaryPersonnel(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer md:relative md:opacity-100 md:bg-transparent md:text-[var(--theme-text)] md:focus:outline-none md:uppercase md:font-black md:tracking-tight md:ml-2 md:w-auto"
                >
                  <option value="ALL">All Staff</option>
                  {personnel
                    .filter(p => {
                      const matchesGroup = summaryGroup === 'ALL' || p.rosterGroup === summaryGroup;
                      const matchesCompany = summaryCompany === 'ALL' || p.company === summaryCompany;
                      return matchesGroup && matchesCompany;
                    })
                    .sort((a,b) => a.fullName.localeCompare(b.fullName))
                    .map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
                <span className="hidden md:block ml-2 text-[var(--theme-text)] font-black uppercase tracking-tight">{summaryPersonnel === 'ALL' ? 'Staff' : personnel.find(p => p.id === summaryPersonnel)?.fullName.split(' ')[0]}</span>
             </div>

             <div className="relative flex items-center justify-center w-10 md:w-auto md:h-auto md:px-4 py-2 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl text-[10px] shadow-sm flex-none">
                <Calendar size={12} className="text-[var(--theme-text-muted)]" />
                <select 
                  value={summaryMonth} 
                  onChange={(e) => setSummaryMonth(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer md:relative md:opacity-100 md:bg-transparent md:text-[var(--theme-text)] md:focus:outline-none md:uppercase md:font-black md:tracking-tight md:ml-2 md:w-auto"
                >
                  <option value="ALL">All Months</option>
                  {availableMonths.map(m => <option key={m} value={m}>{formatPeriod(m)}</option>)}
                </select>
                <span className="hidden md:block ml-2 text-[var(--theme-text)] font-black uppercase tracking-tight">{summaryMonth === 'ALL' ? 'Months' : formatPeriod(summaryMonth)}</span>
             </div>

             <div className="relative flex items-center justify-center w-10 md:w-auto md:h-auto md:px-4 py-2 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl text-[10px] shadow-sm flex-none">
                <Activity size={12} className="text-[var(--theme-text-muted)]" />
                <select 
                  value={summaryStatus} 
                  onChange={(e) => setSummaryStatus(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer md:relative md:opacity-100 md:bg-transparent md:text-[var(--theme-text)] md:focus:outline-none md:uppercase md:font-black md:tracking-tight md:ml-2 md:w-auto"
                >
                  <option value="ALL">All Status</option>
                  <option value="Requested">Requested</option>
                  <option value="Received">Received</option>
                  <option value="Need Action">Need Action</option>
                  <option value="Pending">Pending</option>
                </select>
                <span className="hidden md:block ml-2 text-[var(--theme-text)] font-black uppercase tracking-tight">{summaryStatus === 'ALL' ? 'Status' : summaryStatus}</span>
             </div>

             <div className="flex items-center gap-2 md:gap-3 flex-1 md:flex-none justify-end">
               <button 
                 onClick={exportToExcel}
                 className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 md:px-5 py-2.5 bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-xl md:rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-blue-900/10"
               >
                 <Download size={14} />
                 <span className="hidden xs:inline">Export</span>
               </button>

               <button 
                 onClick={() => copyAsImage('flight-requests-summary')}
                 className="p-2.5 rounded-xl bg-[var(--theme-card)] border border-[var(--theme-border)] hover:bg-[var(--theme-status)] hover:shadow-xl transition-all text-[var(--theme-text-muted)] hover:text-blue-600 shadow-sm"
                 title="Copy Image"
               >
                 {copying === 'flight-requests-summary' ? <Check size={18} /> : <Copy size={18} />}
               </button>
             </div>
          </div>
        </div>

        <div className="p-0 overflow-x-auto custom-scrollbar bg-white">
          <table className="hidden md:table w-full text-left border-collapse">
            <thead className="bg-[#F8FAFC] border-b border-slate-100">
              <tr className="text-[10px] text-slate-400 font-extrabold uppercase tracking-[0.2em]">
                <th 
                  className="py-5 px-8 text-left cursor-pointer hover:text-blue-600 transition-colors"
                  onClick={() => setSummarySort(prev => ({ key: 'personnel', direction: prev.key === 'personnel' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                >
                  <div className="flex items-center gap-2">
                    Personnel 
                    {summarySort.key === 'personnel' && (summarySort.direction === 'asc' ? <ArrowUp size={10} className="ml-1" /> : <ArrowDown size={10} className="ml-1" />)}
                  </div>
                </th>
                <th 
                  className="py-5 px-8 text-left cursor-pointer hover:text-blue-600 transition-colors"
                  onClick={() => setSummarySort(prev => ({ key: 'duty', direction: prev.key === 'duty' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                >
                  <div className="flex items-center gap-2">
                    Duty Period
                    {summarySort.key === 'duty' && (summarySort.direction === 'asc' ? <ArrowUp size={10} className="ml-1" /> : <ArrowDown size={10} className="ml-1" />)}
                  </div>
                </th>
                <th className="py-5 px-8 text-left">Route Details</th>
                <th 
                  className="py-5 px-8 text-left cursor-pointer hover:text-blue-600 transition-colors"
                  onClick={() => setSummarySort(prev => ({ key: 'date', direction: prev.key === 'date' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                >
                  <div className="flex items-center gap-2">
                    Action Status
                    {summarySort.key === 'date' && (summarySort.direction === 'asc' ? <ArrowUp size={10} className="ml-1" /> : <ArrowDown size={10} className="ml-1" />)}
                  </div>
                </th>
                <th className="py-5 px-8 text-left">Status</th>
                <th className="py-5 px-8 text-left">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredSummaryFlights.map((flight) => {
                const person = personnel.find(p => p.id === flight.personnelId);
                return (
                  <tr key={flight.id} className="hover:bg-slate-50 group transition-colors">
                    <td className="py-6 px-8">
                       <div className="flex flex-col">
                          <span className="text-[13px] text-black font-black uppercase leading-tight tracking-tight">{person?.fullName || 'Crew member'}</span>
                          <span className="text-[10px] text-slate-400 font-mono font-bold mt-1 uppercase tracking-widest">{person?.rosterGroup || 'LOGISTICS CORE'}</span>
                       </div>
                    </td>
                    <td className="py-6 px-8">
                       <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
                             <Calendar size={14} className="text-slate-400" />
                          </div>
                          <div className="flex flex-col">
                             <span className="text-[11px] text-[#0F172A] font-mono font-black tabular-nums">
                                {flight.startDate ? `${formatDate(flight.startDate)}` : 'N/A'}
                             </span>
                             <span className="text-[11px] text-slate-400 font-mono font-black tabular-nums">
                                {flight.endDate ? `${formatDate(flight.endDate)}` : 'N/A'}
                             </span>
                          </div>
                       </div>
                    </td>
                    <td className="py-6 px-8">
                       <div className="flex flex-col gap-3 min-w-[280px]">
                         {flight.requestedDateIDtoDZ && (
                           <div className="flex items-center gap-4 group/intel">
                             <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                                <ArrowLeft size={12} className="text-emerald-600" />
                             </div>
                             <div className="flex-1">
                               <div className="flex justify-between items-center mb-1">
                                  <span className="text-[10px] text-[#0F172A] font-black uppercase tracking-widest">Indonesia → Algeria</span>
                                  <div className="flex flex-col items-end">
                                     <span className="text-[10px] text-black font-mono font-black tabular-nums">{formatDate(flight.requestedDateIDtoDZ)}</span>
                                     <span className="text-[8px] text-slate-500 font-bold uppercase">
                                        {getDaysUntil(flight.requestedDateIDtoDZ) === 0 ? 'TODAY' : 
                                         getDaysUntil(flight.requestedDateIDtoDZ) < 0 ? 'OVERDUE' : 
                                         `${getDaysUntil(flight.requestedDateIDtoDZ)}d remaining`}
                                     </span>
                                  </div>
                               </div>
                               <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-emerald-500 rounded-full" 
                                    style={{ width: `${Math.max(0, 100 - (getDaysUntil(flight.requestedDateIDtoDZ) * 5))}%` }}
                                  />
                               </div>
                             </div>
                           </div>
                         )}
                         {flight.requestedDateDZtoID && (
                           <div className="flex items-center gap-4 group/intel">
                             <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
                                <ArrowRight size={12} className="text-blue-600" />
                             </div>
                             <div className="flex-1">
                               <div className="flex justify-between items-center mb-1">
                                  <span className="text-[10px] text-[#0F172A] font-black uppercase tracking-widest">Algeria → Indonesia</span>
                                  <div className="flex flex-col items-end">
                                     <span className="text-[10px] text-black font-mono font-black tabular-nums">{formatDate(flight.requestedDateDZtoID)}</span>
                                     <span className="text-[8px] text-slate-500 font-bold uppercase">
                                        {getDaysUntil(flight.requestedDateDZtoID) === 0 ? 'TODAY' : 
                                         getDaysUntil(flight.requestedDateDZtoID) < 0 ? 'OVERDUE' : 
                                         `${getDaysUntil(flight.requestedDateDZtoID)}d remaining`}
                                     </span>
                                  </div>
                               </div>
                               <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-blue-500 rounded-full" 
                                    style={{ width: `${Math.max(0, 100 - (getDaysUntil(flight.requestedDateDZtoID) * 5))}%` }}
                                  />
                               </div>
                             </div>
                           </div>
                         )}
                       </div>
                    </td>
                    <td className="py-6 px-8 text-center min-w-[150px]">
                       <div className="flex flex-col items-center gap-2">
                         {flight.requestedDateIDtoDZ && (
                           <div className={cn(
                             "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border",
                             getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ) === 'COMPLETED' ? "bg-emerald-600 text-white border-emerald-500/20 shadow-sm" :
                             getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ) === 'Need Action' || getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ) === 'OVERDUE'
                               ? "bg-rose-600 text-white border-rose-500/20 shadow-sm"
                               : flight.statusIDtoDZ === 'Requested'
                                 ? "bg-indigo-600 text-white border-indigo-500/20 shadow-sm"
                                 : "bg-orange-600 text-white border-orange-500/20 shadow-sm"
                           )}>
                             {getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ)}
                           </div>
                         )}
                         {flight.requestedDateDZtoID && (
                           <div className={cn(
                             "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border",
                             getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID) === 'COMPLETED' ? "bg-blue-600 text-white border-blue-500/20 shadow-sm" :
                             getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID) === 'Need Action' || getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID) === 'OVERDUE'
                               ? "bg-rose-600 text-white border-rose-500/20 shadow-sm"
                               : flight.statusDZtoID === 'Requested'
                                 ? "bg-indigo-600 text-white border-indigo-500/20 shadow-sm"
                                 : "bg-orange-600 text-white border-orange-500/20 shadow-sm"
                           )}>
                             {getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID)}
                           </div>
                         )}
                       </div>
                    </td>
                    <td className="py-6 px-8 text-left">
                      <div className="flex flex-col gap-2">
                        {flight.requestedDateIDtoDZ && (
                          <span className={cn(
                            "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                            flight.statusIDtoDZ === 'Received' ? "text-emerald-600 bg-emerald-50" : 
                            getDaysUntil(flight.requestedDateIDtoDZ) < 0 ? "text-rose-600 bg-rose-50 animate-pulse" : "text-slate-400"
                          )}>
                            {flight.statusIDtoDZ === 'Received' ? 'COMPLETED' : 
                             getDaysUntil(flight.requestedDateIDtoDZ) < 0 ? 'OVERDUE' : '--'}
                          </span>
                        )}
                        {flight.requestedDateDZtoID && (
                          <span className={cn(
                            "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                            flight.statusDZtoID === 'Received' ? "text-emerald-600 bg-emerald-50" : 
                            getDaysUntil(flight.requestedDateDZtoID) < 0 ? "text-rose-600 bg-rose-50 animate-pulse" : "text-slate-400"
                          )}>
                            {flight.statusDZtoID === 'Received' ? 'COMPLETED' : 
                             getDaysUntil(flight.requestedDateDZtoID) < 0 ? 'OVERDUE' : '--'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile Card Layout */}
          <div className="md:hidden divide-y divide-slate-50 bg-white">
            {filteredSummaryFlights.map((flight) => {
              const person = personnel.find(p => p.id === flight.personnelId);
              return (
                <div key={flight.id} className="p-6 space-y-6 hover:bg-slate-50 transition-all">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-[14px] text-[#0F172A] font-black uppercase tracking-tight leading-tight">{person?.fullName || 'Crew member'}</h4>
                      <p className="text-[10px] text-slate-400 font-mono font-bold mt-1 uppercase tracking-widest">{person?.rosterGroup || 'LOGISTICS CORE'}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-4">
                     <div className="p-4 bg-[#F8FAFC] border border-slate-100 rounded-2xl flex items-center justify-between">
                        <div>
                           <p className="text-[9px] font-black text-slate-400 uppercase mb-1 tracking-widest">Rotation Span</p>
                           <p className="text-[11px] font-mono font-black text-[#0F172A] tabular-nums">{flight.startDate ? `${formatDate(flight.startDate)} — ${formatDate(flight.endDate)}` : 'N/A'}</p>
                        </div>
                        <Calendar size={18} className="text-slate-200" />
                     </div>

                     <div className="space-y-3">
                        {flight.requestedDateIDtoDZ && (
                           <div className="p-4 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-2xl flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                    <ArrowLeft size={12} className="text-emerald-500" />
                                 </div>
                                 <div>
                                    <p className="text-[9px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest">Indonesia → Algeria</p>
                                    <div className="flex items-center gap-2">
                                       <p className="text-[11px] font-mono font-black text-[var(--theme-text)] tabular-nums">{formatDate(flight.requestedDateIDtoDZ)}</p>
                                       <span className="text-[8px] text-rose-500 font-bold uppercase">
                                          {getDaysUntil(flight.requestedDateIDtoDZ) === 0 ? 'TODAY' : 
                                           getDaysUntil(flight.requestedDateIDtoDZ) < 0 ? 'OVERDUE' : 
                                           `${getDaysUntil(flight.requestedDateIDtoDZ)}d remaining`}
                                       </span>
                                    </div>
                                 </div>
                              </div>
                              <div className={cn(
                                 "px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border shadow-sm",
                                 getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ) === 'Need Action' || getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ) === 'OVERDUE'
                                   ? "bg-rose-600 text-white border-rose-500/20"
                                   : getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ) === 'COMPLETED'
                                     ? "bg-emerald-600 text-white border-emerald-500/20"
                                     : flight.statusIDtoDZ === 'Requested'
                                       ? "bg-blue-600 text-white border-blue-500/20"
                                       : "bg-orange-600 text-white border-orange-500/20"
                              )}>
                                 {getEffectiveStatus(flight.statusIDtoDZ || 'Requested', flight.requestedDateIDtoDZ)}
                              </div>
                           </div>
                        )}
                        {flight.requestedDateDZtoID && (
                           <div className="p-4 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-2xl flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                                    <ArrowRight size={12} className="text-blue-600" />
                                 </div>
                                 <div>
                                    <p className="text-[9px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest">Algeria → Indonesia</p>
                                    <div className="flex items-center gap-2">
                                       <p className="text-[11px] font-mono font-black text-[var(--theme-text)] tabular-nums">{formatDate(flight.requestedDateDZtoID)}</p>
                                       <span className="text-[8px] text-blue-500 font-bold uppercase">
                                          {getDaysUntil(flight.requestedDateDZtoID) === 0 ? 'TODAY' : 
                                           getDaysUntil(flight.requestedDateDZtoID) < 0 ? 'OVERDUE' : 
                                           `${getDaysUntil(flight.requestedDateDZtoID)}d remaining`}
                                       </span>
                                    </div>
                                 </div>
                              </div>
                              <div className={cn(
                                 "px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border shadow-sm",
                                 getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID) === 'Need Action' || getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID) === 'OVERDUE'
                                   ? "bg-rose-600 text-white border-rose-100 shadow-[0_0_12px_rgba(225,29,72,0.4)]"
                                   : getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID) === 'COMPLETED'
                                     ? "bg-blue-600 text-white border-blue-100 shadow-[0_0_12px_rgba(37,99,235,0.4)]"
                                     : flight.statusDZtoID === 'Requested'
                                       ? "bg-blue-600 text-white border-blue-100"
                                       : "bg-orange-600 text-white border-orange-100 shadow-[0_0_12px_rgba(249,115,22,0.4)]"
                              )}>
                                 {getEffectiveStatus(flight.statusDZtoID || 'Requested', flight.requestedDateDZtoID)}
                              </div>
                           </div>
                        )}
                     </div>
                  </div>
                </div>
              );
            })}
          </div>
          {filteredSummaryFlights.length === 0 && (
            <div className="py-20 text-center opacity-20">
              <Plane size={32} className="mx-auto mb-2" />
              <p className="text-[10px] font-mono uppercase">System Idle - All Transits Cleared</p>
            </div>
          )}
        </div>
      </div>
      {/* Detail Modal for Awaiting Ops Action */}
      <AnimatePresence>
        {selectedAwaitingItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setSelectedAwaitingItem(null)}
              className="absolute inset-0 bg-[#0F172A]/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[3rem] border border-slate-100 shadow-[0_50px_100px_rgba(15,23,42,0.15)] overflow-hidden"
            >
              <div className="p-10">
                <div className="flex items-start justify-between mb-10">
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 rounded-[2rem] bg-blue-50 flex items-center justify-center text-3xl font-black text-blue-600 shadow-inner">
                      {selectedAwaitingItem.person?.fullName.charAt(0)}
                    </div>
                    <div>
                      <h4 className="text-2xl font-black text-[#0F172A] uppercase tracking-tighter leading-tight">
                        {selectedAwaitingItem.person?.fullName}
                      </h4>
                      <p className="text-[12px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-1 italic">
                        {selectedAwaitingItem.person?.title} • {selectedAwaitingItem.person?.rosterGroup}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedAwaitingItem(null)}
                    className="p-3 hover:bg-slate-50 rounded-full transition-colors text-slate-400 hover:text-rose-500"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="grid grid-cols-1 mb-10">
                  <div className="p-6 bg-emerald-50 rounded-3xl border border-emerald-100">
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-3">Group Anchor</p>
                    <p className="text-lg font-black text-emerald-700 uppercase tracking-tight">{selectedAwaitingItem.person?.rosterGroup || 'CORE'}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-6 bg-white border border-slate-100 rounded-3xl flex items-center justify-between hover:border-blue-200 transition-all shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                        <ArrowLeft size={20} />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">INDONESIA → ALGERIA</p>
                        <p className="text-sm font-black text-[#0F172A] mt-0.5">
                          {selectedAwaitingItem.flight.requestedDateIDtoDZ ? formatDate(selectedAwaitingItem.flight.requestedDateIDtoDZ) : 'N/A'}
                        </p>
                        {selectedAwaitingItem.flight.requestedDateIDtoDZ && (
                          <span className="text-[8px] text-emerald-600 font-bold uppercase mt-1 block">
                            {getDaysUntil(selectedAwaitingItem.flight.requestedDateIDtoDZ)}d remaining
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={cn(
                      "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border",
                      selectedAwaitingItem.flight.statusIDtoDZ === 'Requested' ? "bg-rose-50 text-rose-600 border-rose-100 shadow-[0_0_12px_rgba(244,63,94,0.1)]" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                    )}>
                      {selectedAwaitingItem.flight.statusIDtoDZ}
                    </div>
                  </div>

                  <div className="p-6 bg-white border border-slate-100 rounded-3xl flex items-center justify-between hover:border-blue-200 transition-all shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                        <ArrowRight size={20} />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ALGERIA → INDONESIA</p>
                        <p className="text-sm font-black text-[#0F172A] mt-0.5">
                          {selectedAwaitingItem.flight.requestedDateDZtoID ? formatDate(selectedAwaitingItem.flight.requestedDateDZtoID) : 'N/A'}
                        </p>
                        {selectedAwaitingItem.flight.requestedDateDZtoID && (
                          <span className="text-[8px] text-blue-600 font-bold uppercase mt-1 block">
                            {getDaysUntil(selectedAwaitingItem.flight.requestedDateDZtoID)}d remaining
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={cn(
                      "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border",
                      selectedAwaitingItem.flight.statusDZtoID === 'Requested' ? "bg-rose-50 text-rose-600 border-rose-100 shadow-[0_0_12px_rgba(244,63,94,0.1)]" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                    )}>
                      {selectedAwaitingItem.flight.statusDZtoID}
                    </div>
                  </div>
                </div>

                <div className="mt-10 flex gap-4">
                  <button 
                    onClick={() => setSelectedAwaitingItem(null)}
                    className="w-full py-4 bg-slate-50 text-slate-400 text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-slate-100 transition-all"
                  >
                    Close Log
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
