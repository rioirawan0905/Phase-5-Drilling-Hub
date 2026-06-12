import { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, getDocs, updateDoc, doc, Timestamp, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Personnel, FlightRequest, Scheduling, FlightType, FlightStatus } from '../types';
import { Plane, Calendar, Clock, Plus, Filter, ArrowUpRight, ArrowDownRight, CheckCircle2, AlertCircle, XCircle, Trash2, Pencil, ArrowRight, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn, formatDate } from '../lib/utils';
import { ConfirmModal } from './ConfirmModal';

const flightRequestSchema = z.object({
  personnelIds: z.array(z.string()).min(1, 'At least one person must be selected'),
  schedulingId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  requestedDateDZtoID: z.string().optional(),
  requestedDateIDtoDZ: z.string().optional(),
}).refine(data => data.requestedDateDZtoID || data.requestedDateIDtoDZ, {
  message: "At least one ticket date must be specified",
  path: ["requestedDateDZtoID"]
});

type FlightRequestFormData = z.infer<typeof flightRequestSchema>;

const scheduleSchema = z.object({
  personnelId: z.string().min(1, 'Personnel is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  status: z.enum(['ON_DUTY', 'OFF_DUTY', 'TRANSIT'] as const),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;

interface FlightsListProps {
  isGuest?: boolean;
}

export function FlightsList({ isGuest }: FlightsListProps) {
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [flights, setFlights] = useState<FlightRequest[]>([]);
  const [schedules, setSchedules] = useState<Scheduling[]>([]);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [editingFlight, setEditingFlight] = useState<FlightRequest | null>(null);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'Active' | 'Completed'>('Active');
  const [sortConfig, setSortConfig] = useState<{ key: 'personnel' | 'duty' | 'date' | 'status', direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' });

  // Filters State
  const [filterMonth, setFilterMonth] = useState<string>('ALL');
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [filterGroup, setFilterGroup] = useState<string>('ALL');
  const [filterPersonnel, setFilterPersonnel] = useState<string>('ALL');
  const [filterCompany, setFilterCompany] = useState<string>('ALL');

  const { register: regRequest, handleSubmit: handleReqSubmit, reset: resetReq, setValue: setReqValue, watch: watchReq, formState: { errors: reqErrors } } = useForm<FlightRequestFormData>({
    resolver: zodResolver(flightRequestSchema),
    defaultValues: { personnelIds: [] }
  });

  const selectedPersonnelIds = watchReq('personnelIds') || [];

  const commonSchedules = useMemo(() => {
    if (selectedPersonnelIds.length === 0) return [];
    
    // Get all schedules for all selected personnel
    const allSelectedSchedules = schedules.filter(s => selectedPersonnelIds.includes(s.personnelId));
    
    if (selectedPersonnelIds.length === 1) {
      return allSelectedSchedules;
    }

    // Find unique duty periods (startDate + endDate)
    const uniquePeriods = Array.from(new Set(allSelectedSchedules.map(s => `${s.startDate}|${s.endDate}`)));
    
    // Filter periods that are present for ALL selected personnel
    return (uniquePeriods as string[]).filter(period => {
      const [start, end] = period.split('|');
      return selectedPersonnelIds.every(pid => 
        allSelectedSchedules.some(s => s.personnelId === pid && s.startDate === start && s.endDate === end)
      );
    }).map(period => {
      const [start, end] = (period as string).split('|');
      // Just return a representative schedule (the first one found) or a virtual one
      return allSelectedSchedules.find(s => s.startDate === start && s.endDate === end);
    }).filter(Boolean) as Scheduling[];
  }, [selectedPersonnelIds, schedules]);

  const { register: regSched, handleSubmit: handleSchedSubmit, reset: resetSched, formState: { errors: schedErrors } } = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { status: 'ON_DUTY' }
  });

  useEffect(() => {
    const unsubPersonnel = onSnapshot(collection(db, 'personnel'), (snap) => {
      setPersonnel(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Personnel)));
    });

    const unsubFlights = onSnapshot(collection(db, 'flightRequests'), (snap) => {
      setFlights(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FlightRequest)));
    });

    const unsubSchedules = onSnapshot(collection(db, 'schedules'), (snap) => {
      setSchedules(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scheduling)));
    });

    return () => {
      unsubPersonnel();
      unsubFlights();
      unsubSchedules();
    };
  }, []);

  const onCreateRequest = async (data: FlightRequestFormData) => {
    try {
      const selectedSchedule = schedules.find(s => s.id === data.schedulingId);
      const finalStartDate = selectedSchedule?.startDate || data.startDate || '';
      const finalEndDate = selectedSchedule?.endDate || data.endDate || '';

      const promises = data.personnelIds.map(pid => {
        const baseData = {
          personnelId: pid,
          schedulingId: data.schedulingId || null,
          startDate: finalStartDate,
          endDate: finalEndDate,
          requestedDateDZtoID: data.requestedDateDZtoID || null,
          requestedDateIDtoDZ: data.requestedDateIDtoDZ || null,
          statusDZtoID: data.requestedDateDZtoID ? 'Requested' : 'Not Requested',
          statusIDtoDZ: data.requestedDateIDtoDZ ? 'Requested' : 'Not Requested',
          status: 'Requested', // Aggregate for legacy
          createdAt: serverTimestamp()
        };

        if (editingFlight) {
          return updateDoc(doc(db, 'flightRequests', editingFlight.id), baseData);
        } else {
          return addDoc(collection(db, 'flightRequests'), baseData);
        }
      });

      await Promise.all(promises);
      handleCloseRequestModal();
    } catch (error) {
      handleFirestoreError(error, editingFlight ? OperationType.UPDATE : OperationType.CREATE, editingFlight ? `flightRequests/${editingFlight.id}` : 'flightRequests');
    }
  };

  const handleEditFlight = (f: FlightRequest) => {
    setEditingFlight(f);
    setReqValue('personnelIds', [f.personnelId]);
    setReqValue('schedulingId', f.schedulingId || '');
    setReqValue('startDate', f.startDate || '');
    setReqValue('endDate', f.endDate || '');
    setReqValue('requestedDateDZtoID', f.requestedDateDZtoID || '');
    setReqValue('requestedDateIDtoDZ', f.requestedDateIDtoDZ || '');
    setIsRequestModalOpen(true);
  };

  const handleCloseRequestModal = () => {
    setIsRequestModalOpen(false);
    setEditingFlight(null);
    resetReq();
  };

  const onCreateSchedule = async (data: ScheduleFormData) => {
    try {
      await addDoc(collection(db, 'schedules'), data);
      setIsScheduleModalOpen(false);
      resetSched();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'schedules');
    }
  };

  const getStatusStyle = (status: FlightStatus, requestedDate?: string | null) => {
    if (status === 'Received') return "bg-emerald-600 text-white border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)] font-black px-2 py-0.5 rounded";
    
    // Explicit or Auto "Need Action" logic
    let isUrgent = status === 'Need Action';
    if (requestedDate) {
      const flightDate = new Date(requestedDate);
      const today = new Date();
      const diffTime = flightDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      // Apply Need Action if date is within 14 days OR past today (Overdue)
      if (diffDays <= 14) isUrgent = true;
    }

    if (isUrgent) {
      return "bg-rose-600 text-white animate-pulse font-black px-2 py-0.5 rounded shadow-[0_0_12px_rgba(225,29,72,0.4)]";
    }

    if (status === 'Not Requested') return "bg-orange-500 text-white border-orange-400/30 px-2 py-0.5 rounded font-black shadow-[0_0_10px_rgba(249,115,22,0.2)]"; 
    if (status === 'Requested') return "bg-blue-600 text-white font-black px-2 py-0.5 rounded text-center min-w-[70px] shadow-[0_0_10px_rgba(37,99,235,0.2)]";
    return "bg-indigo-600 text-white font-black px-2 py-0.5 rounded text-center min-w-[70px] shadow-[0_0_10px_rgba(79,70,229,0.2)]";
  };

  const getStatusLabel = (status: FlightStatus, requestedDate?: string | null) => {
    if (status === 'Received') return "Received";
    
    if (requestedDate) {
      const flightDate = new Date(requestedDate);
      const today = new Date();
      const diffTime = flightDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 0) return "Overdue";
      if (diffDays <= 14) return "Need Action";
    }

    if (status === 'Not Requested') return "Pending";
    return status;
  };

  const updateTransitStatus = async (id: string, leg: 'DZtoID' | 'IDtoDZ', status: FlightStatus) => {
    try {
      const field = leg === 'DZtoID' ? 'statusDZtoID' : 'statusIDtoDZ';
      await updateDoc(doc(db, 'flightRequests', id), { [field]: status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `flightRequests/${id}`);
    }
  };

  const handleDeleteRequest = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteDoc(doc(db, 'flightRequests', deleteConfirmId));
      setDeleteConfirmId(null);
    } catch (error) {
       handleFirestoreError(error, OperationType.DELETE, `flightRequests/${deleteConfirmId}`);
    }
  };

  const filteredFlights = useMemo(() => {
    let result = flights.filter(f => {
      const person = personnel.find(p => p.id === f.personnelId);
      
      // Personnel filter
      if (filterPersonnel !== 'ALL' && f.personnelId !== filterPersonnel) return false;
      
      // Group filter
      if (filterGroup !== 'ALL' && person?.rosterGroup !== filterGroup) return false;

      // Company filter
      if (filterCompany !== 'ALL' && person?.company !== filterCompany) return false;
      
      // Year filter (checking duty period and flight dates)
      const flightDates = [f.startDate, f.endDate, f.requestedDateDZtoID, f.requestedDateIDtoDZ].filter(Boolean) as string[];
      if (filterYear !== 'ALL') {
        const hasYear = flightDates.some(d => d.startsWith(filterYear));
        if (!hasYear) return false;
      }
      
      // Month filter
      if (filterMonth !== 'ALL') {
        const hasMonth = flightDates.some(d => {
          if (!d) return false;
          return d.split('-')[1] === filterMonth.padStart(2, '0');
        });
        if (!hasMonth) return false;
      }

      // Tab Filtering: "Completed" means ALL legs are Received
      const isCompleted = (f.requestedDateDZtoID ? f.statusDZtoID === 'Received' : true) && 
                          (f.requestedDateIDtoDZ ? f.statusIDtoDZ === 'Received' : true);
      
      if (activeTab === 'Completed' && !isCompleted) return false;
      if (activeTab === 'Active' && isCompleted) return false;
      
      return true;
    });

    // Sorting Logic
    result = result.sort((a, b) => {
      const personA = personnel.find(p => p.id === a.personnelId);
      const personB = personnel.find(p => p.id === b.personnelId);

      const getEarliest = (f: FlightRequest) => {
        const dates = [f.requestedDateDZtoID, f.requestedDateIDtoDZ]
          .filter(Boolean)
          .map(d => new Date(d!).getTime());
        return dates.length > 0 ? Math.min(...dates) : Infinity;
      };

      const getStatusRank = (f: FlightRequest) => {
        const s1 = getStatusLabel(f.statusDZtoID || 'Requested', f.requestedDateDZtoID);
        const s2 = getStatusLabel(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ);
        if (s1 === 'Overdue' || s2 === 'Overdue') return 0;
        if (s1 === 'Need Action' || s2 === 'Need Action') return 1;
        if (s1 === 'Requested' || s2 === 'Requested') return 2;
        return 3;
      };

      let comparison = 0;
      switch (sortConfig.key) {
        case 'personnel':
          comparison = (personA?.fullName || '').localeCompare(personB?.fullName || '');
          break;
        case 'duty':
          comparison = (a.startDate || '').localeCompare(b.startDate || '');
          break;
        case 'date':
          comparison = getEarliest(a) - getEarliest(b);
          break;
        case 'status':
          comparison = getStatusRank(a) - getStatusRank(b);
          break;
        default:
          comparison = (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      }
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [flights, personnel, filterMonth, filterYear, filterGroup, filterPersonnel, filterCompany, activeTab, sortConfig]);

  const uniqueGroups = useMemo(() => {
    const groups = new Set(personnel.map(p => p.rosterGroup).filter(Boolean));
    return Array.from(groups).sort();
  }, [personnel]);

  const uniqueCompanies = useMemo(() => {
    const companies = new Set(personnel.map(p => p.company).filter(Boolean));
    return Array.from(companies).sort();
  }, [personnel]);

  return (
    <div className="space-y-4 md:space-y-6 pb-20">
      {/* View Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-xs md:text-sm font-semibold uppercase tracking-wider text-[var(--theme-text)]">Flight Ticket Request</h2>
          <p className="text-[9px] md:text-[10px] text-[var(--theme-text-muted)] font-extrabold uppercase tracking-widest mt-0.5">Manifest Terminal</p>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          {!isGuest && (
            <button 
              onClick={() => setIsRequestModalOpen(true)}
              className="btn-primary py-2 px-4 text-[10px] flex-1 md:flex-none justify-center whitespace-nowrap"
            >
              + New Request
            </button>
          )}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col gap-4 p-3 md:p-4 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex bg-[var(--theme-status)] p-1 rounded-xl border border-[var(--theme-border)]">
              <button 
                onClick={() => setActiveTab('Active')}
                className={cn(
                  "px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all",
                  activeTab === 'Active' ? "bg-blue-600 text-white shadow-lg" : "text-[var(--theme-text-muted)] hover:text-blue-600"
                )}
              >
                Active
              </button>
              <button 
                onClick={() => setActiveTab('Completed')}
                className={cn(
                  "px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all",
                  activeTab === 'Completed' ? "bg-emerald-600 text-white shadow-lg" : "text-[var(--theme-text-muted)] hover:text-emerald-600"
                )}
              >
                Completed
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Filter size={12} className="text-[var(--theme-text-muted)] border-l border-[var(--theme-border)] pl-2" />
              <span className="text-[9px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest">Filters</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 flex-1">
          <div className="space-y-1">
            <label className="text-[8px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Month</label>
            <select 
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-[var(--theme-text)] rounded-lg focus:outline-none"
            >
              <option value="ALL">ALL MONTHS</option>
              {[
                { v: '01', l: 'JANUARY' }, { v: '02', l: 'FEBRUARY' }, { v: '03', l: 'MARCH' },
                { v: '04', l: 'APRIL' }, { v: '05', l: 'MAY' }, { v: '06', l: 'JUNE' },
                { v: '07', l: 'JULY' }, { v: '08', l: 'AUGUST' }, { v: '09', l: 'SEPTEMBER' },
                { v: '10', l: 'OCTOBER' }, { v: '11', l: 'NOVEMBER' }, { v: '12', l: 'DECEMBER' }
              ].map(m => (
                <option key={m.v} value={m.v}>{m.l}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Year</label>
            <select 
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-[var(--theme-text)] rounded-lg focus:outline-none"
            >
              <option value="ALL">ALL YEARS</option>
              <option value="2024">2024</option>
              <option value="2025">2025</option>
              <option value="2026">2026</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Group</label>
            <select 
              value={filterGroup}
              onChange={(e) => {
                setFilterGroup(e.target.value);
                setFilterPersonnel('ALL');
              }}
              className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-[var(--theme-text)] rounded-lg focus:outline-none"
            >
              <option value="ALL">ALL GROUPS</option>
              {uniqueGroups.map(g => (
                <option key={g} value={g}>GROUP {g}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Company</label>
            <select 
              value={filterCompany}
              onChange={(e) => {
                setFilterCompany(e.target.value);
                setFilterPersonnel('ALL');
              }}
              className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-[var(--theme-text)] rounded-lg focus:outline-none"
            >
              <option value="ALL">ALL COMPANIES</option>
              {uniqueCompanies.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Personnel</label>
            <select 
              value={filterPersonnel}
              onChange={(e) => setFilterPersonnel(e.target.value)}
              className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-[var(--theme-text)] rounded-lg focus:outline-none"
            >
              <option value="ALL">ALL PERSONNEL</option>
              {personnel
                .filter(p => {
                  if (filterGroup !== 'ALL' && p.rosterGroup !== filterGroup) return false;
                  if (filterCompany !== 'ALL' && p.company !== filterCompany) return false;
                  return true;
                })
                .sort((a,b) => a.fullName.localeCompare(b.fullName))
                .map(p => (
                  <option key={p.id} value={p.id}>{p.fullName}</option>
                ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-2xl overflow-hidden shadow-xl shadow-black/5">
        <div className="overflow-x-auto md:overflow-x-visible custom-scrollbar">
          {/* Desktop Table */}
          <table className="hidden md:table w-full text-left min-w-[800px] md:min-w-0">
          <thead className="text-[10px] text-[var(--theme-text-muted)] uppercase tracking-widest bg-[var(--theme-status)] border-b border-[var(--theme-border)]">
            <tr>
              <th 
                className="py-4 px-6 font-black cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() => setSortConfig(prev => ({ key: 'personnel', direction: prev.key === 'personnel' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
              >
                <div className="flex items-center gap-1">
                  Personnel
                  {sortConfig.key === 'personnel' && (sortConfig.direction === 'asc' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />)}
                </div>
              </th>
              <th 
                className="py-4 px-6 font-black cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() => setSortConfig(prev => ({ key: 'duty', direction: prev.key === 'duty' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
              >
                <div className="flex items-center gap-1">
                  Duty Period
                  {sortConfig.key === 'duty' && (sortConfig.direction === 'asc' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />)}
                </div>
              </th>
              <th className="py-4 px-6 font-black">Transit Route / Leg Control</th>
              <th className="py-4 px-6 font-black text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-xs divide-y divide-[var(--theme-border)]">
            {filteredFlights.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-20 text-center text-[10px] uppercase font-mono text-[var(--theme-text-muted)] tracking-widest">
                  No {activeTab.toLowerCase()} requests in system
                </td>
              </tr>
            ) : (
              filteredFlights.map((f) => {
                const person = personnel.find(p => p.id === f.personnelId);
                return (
                  <tr key={f.id} className="hover:bg-[var(--theme-status)] transition-colors group">
                    <td className="py-4 px-6 align-top">
                      <p className="font-black text-[var(--theme-text)] uppercase tracking-tight">{person?.fullName || 'UNKNOWN'}</p>
                      <p className="text-[10px] text-[var(--theme-text-muted)] font-mono font-bold uppercase tracking-widest mt-1">{person?.rosterGroup || 'LOGISTICS CORE'}</p>
                    </td>
                    <td className="py-4 px-6 text-[var(--theme-text-muted)] font-mono whitespace-nowrap align-top">
                      <div className="flex items-center gap-2">
                        <Calendar size={10} className="text-[var(--theme-text-muted)] opacity-50" />
                        <span className="font-black tracking-tighter text-[var(--theme-text)]">{f.startDate ? `${formatDate(f.startDate)} — ${formatDate(f.endDate)}` : 'N/A'}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 align-top">
                      <div className="space-y-3 min-w-[400px]">
                        {f.requestedDateIDtoDZ && (
                          <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--theme-status)] border border-[var(--theme-border)]">
                            <div className="flex items-center gap-3">
                              <ArrowLeft size={12} className="text-emerald-600" />
                              <div>
                                <p className="text-[9px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest">INDONESIA → ALGERIA</p>
                                <p className="text-[11px] text-[var(--theme-text)] font-mono font-black">{formatDate(f.requestedDateIDtoDZ)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className={getStatusStyle(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ)}>
                                {getStatusLabel(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ)}
                              </span>
                              {!isGuest ? (
                                <select 
                                  onChange={(e) => updateTransitStatus(f.id, 'IDtoDZ', e.target.value as FlightStatus)}
                                  value={f.statusIDtoDZ || 'Requested'}
                                  className="bg-[var(--theme-card)] border border-[var(--theme-border)] text-[9px] text-[var(--theme-text)] px-3 py-1 rounded-lg focus:outline-none focus:border-blue-500 font-black uppercase tracking-widest"
                                >
                                  <option value="Not Requested">Not Requested</option>
                                  <option value="Requested">Requested</option>
                                  <option value="Received">Received</option>
                                </select>
                              ) : (
                                <span className="text-[9px] text-[var(--theme-text-muted)] font-bold uppercase">Locked</span>
                              )}
                            </div>
                          </div>
                        )}
                        {f.requestedDateDZtoID && (
                          <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--theme-status)] border border-[var(--theme-border)]">
                            <div className="flex items-center gap-3">
                              <ArrowRight size={12} className="text-blue-600" />
                              <div>
                                <p className="text-[9px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest">ALGERIA → INDONESIA</p>
                                <p className="text-[11px] text-[var(--theme-text)] font-mono font-black">{formatDate(f.requestedDateDZtoID)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className={getStatusStyle(f.statusDZtoID || 'Requested', f.requestedDateDZtoID)}>
                                {getStatusLabel(f.statusDZtoID || 'Requested', f.requestedDateDZtoID)}
                              </span>
                              {!isGuest ? (
                                <select 
                                  onChange={(e) => updateTransitStatus(f.id, 'DZtoID', e.target.value as FlightStatus)}
                                  value={f.statusDZtoID || 'Requested'}
                                  className="bg-[var(--theme-card)] border border-[var(--theme-border)] text-[9px] text-[var(--theme-text)] px-3 py-1 rounded-lg focus:outline-none focus:border-blue-500 font-black uppercase tracking-widest"
                                >
                                  <option value="Not Requested">Not Requested</option>
                                  <option value="Requested">Requested</option>
                                  <option value="Received">Received</option>
                                </select>
                              ) : (
                                <span className="text-[9px] text-[var(--theme-text-muted)] font-bold uppercase">Locked</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-right whitespace-nowrap">
                      {!isGuest && (
                        <div className="flex flex-col items-end gap-2">
                           <button onClick={() => handleEditFlight(f)} className="p-1 px-2 text-[10px] font-bold text-[var(--theme-text-muted)] hover:text-blue-600 uppercase flex items-center gap-1 border border-[var(--theme-border)] rounded w-fit"><Pencil size={11} /> Edit</button>
                           <button onClick={() => setDeleteConfirmId(f.id)} className="p-1 px-2 text-[10px] font-bold text-[var(--theme-text-muted)] hover:text-rose-500 uppercase flex items-center gap-1 border border-[var(--theme-border)] rounded w-fit"><Trash2 size={11} /> Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>

        <div className="md:hidden divide-y divide-[var(--theme-border)] bg-[var(--theme-card)]">
          {filteredFlights.length === 0 ? (
            <div className="py-12 text-center text-[10px] uppercase font-mono text-[var(--theme-text-muted)] tracking-widest px-4 bg-[var(--theme-card)] rounded-2xl border border-[var(--theme-border)] shadow-sm">
              No active requests in system
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredFlights.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map((f) => {
                const person = personnel.find(p => p.id === f.personnelId);
                return (
                  <div key={f.id} className="bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-2xl shadow-sm overflow-hidden flex flex-col group">
                    <div className="p-4 md:hidden border-b border-[var(--theme-border)] bg-[var(--theme-status)] flex justify-between items-start">
                      <div>
                        <p className="font-black text-[13px] text-[var(--theme-text)] uppercase tracking-tight">{person?.fullName || 'UNKNOWN'}</p>
                        <p className="text-[9px] text-[var(--theme-text-muted)] font-mono font-bold uppercase tracking-widest mt-0.5">{person?.rosterGroup || 'SECURE MANIFEST'}</p>
                      </div>
                      <div className="flex gap-2">
                        {!isGuest && (
                          <>
                            <button onClick={() => handleEditFlight(f)} className="p-2 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-lg text-[var(--theme-text-muted)] hover:text-blue-500 transition-colors shadow-sm"><Pencil size={12} /></button>
                            <button onClick={() => setDeleteConfirmId(f.id)} className="p-2 bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-lg text-[var(--theme-text-muted)] hover:text-rose-500 transition-colors shadow-sm"><Trash2 size={12} /></button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Duty Period */}
                    <div className="px-4 py-3 bg-[var(--theme-card)] flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[var(--theme-status)] border border-[var(--theme-border)] flex items-center justify-center">
                        <Calendar size={12} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="text-[8px] text-[var(--theme-text-muted)] uppercase font-black tracking-widest leading-none mb-1">Duty Period</p>
                        <p className="text-[10px] text-[var(--theme-text)] font-mono font-black">{f.startDate ? `${formatDate(f.startDate)} — ${formatDate(f.endDate)}` : 'DATE N/A'}</p>
                      </div>
                    </div>

                    {/* Route Details */}
                    <div className="p-4 pt-0 space-y-3">
                      {f.requestedDateIDtoDZ && (
                        <div className="p-3 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl space-y-2">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <ArrowLeft size={10} className="text-emerald-600" />
                              <span className="text-[8px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest">JKT → ALG</span>
                            </div>
                            <span className={getStatusStyle(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ)}>
                              {getStatusLabel(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-[var(--theme-text)] font-mono font-black">{formatDate(f.requestedDateIDtoDZ)}</span>
                            {!isGuest && (
                              <select 
                                onChange={(e) => updateTransitStatus(f.id, 'IDtoDZ', e.target.value as FlightStatus)}
                                value={f.statusIDtoDZ || 'Requested'}
                                className="bg-[var(--theme-card)] border border-[var(--theme-border)] text-[9px] text-[var(--theme-text)] px-2 py-1 rounded-lg font-black uppercase tracking-widest focus:outline-none"
                              >
                                <option value="Not Requested">Not Requested</option>
                                <option value="Requested">Requested</option>
                                <option value="Received">Received</option>
                              </select>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {f.requestedDateDZtoID && (
                        <div className="p-3 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl space-y-2">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <ArrowRight size={10} className="text-blue-600" />
                              <span className="text-[8px] font-black text-[var(--theme-text-muted)] uppercase tracking-widest">ALG → JKT</span>
                            </div>
                            <span className={getStatusStyle(f.statusDZtoID || 'Requested', f.requestedDateDZtoID)}>
                              {getStatusLabel(f.statusDZtoID || 'Requested', f.requestedDateDZtoID)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-[var(--theme-text)] font-mono font-black">{formatDate(f.requestedDateDZtoID)}</span>
                            {!isGuest && (
                              <select 
                                onChange={(e) => updateTransitStatus(f.id, 'DZtoID', e.target.value as FlightStatus)}
                                value={f.statusDZtoID || 'Requested'}
                                className="bg-[var(--theme-card)] border border-[var(--theme-border)] text-[9px] text-[var(--theme-text)] px-2 py-1 rounded-lg font-black uppercase tracking-widest focus:outline-none"
                              >
                                <option value="Not Requested">Not Requested</option>
                                <option value="Requested">Requested</option>
                                <option value="Received">Received</option>
                              </select>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Modals with Dark Aesthetics */}
      <AnimatePresence>
        {isRequestModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={handleCloseRequestModal} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-[#111114] border border-white/10 p-8 rounded-2xl shadow-2xl">
              <h3 className="text-lg font-bold text-white uppercase tracking-tight mb-6">
                {editingFlight ? 'Edit Flight Request' : 'Flight Ticket Request'}
              </h3>
              <form onSubmit={handleReqSubmit(onCreateRequest)} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Personnel Selection (Multiple Allowed)</label>
                  <div className="flex flex-wrap gap-2 p-3 bg-[#16161a] border border-white/5 rounded-lg min-h-[100px]">
                    {personnel.map(p => {
                      const isSelected = selectedPersonnelIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            const current = selectedPersonnelIds;
                            if (isSelected) {
                              setReqValue('personnelIds', current.filter(id => id !== p.id));
                            } else {
                              setReqValue('personnelIds', [...current, p.id]);
                            }
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all border",
                            isSelected 
                              ? "bg-blue-500/20 border-blue-500 text-blue-400" 
                              : "bg-black/20 border-white/5 text-slate-500 hover:border-white/20"
                          )}
                        >
                          {p.fullName}
                        </button>
                      );
                    })}
                  </div>
                  {reqErrors.personnelIds && <p className="text-[10px] text-rose-500 px-1">{reqErrors.personnelIds.message}</p>}
                </div>

                <div className="space-y-4 p-4 rounded-xl bg-black/40 border border-white/5">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Link to Duty Period (From Roster)</label>
                    <select 
                      {...regRequest('schedulingId')} 
                      className="w-full bg-[#16161a] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none"
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.includes('|')) {
                          const [start, end] = val.split('|');
                          setReqValue('startDate', start);
                          setReqValue('endDate', end);
                        } else {
                          // Handle single ID if it survived (though we changed it to start|end above)
                          const sched = schedules.find(s => s.id === val);
                          if (sched) {
                            setReqValue('startDate', sched.startDate);
                            setReqValue('endDate', sched.endDate);
                          }
                        }
                      }}
                    >
                      <option value="">Manual Entry or Select Period...</option>
                      {commonSchedules.map(s => (
                        <option key={s.id} value={`${s.startDate}|${s.endDate}`}>{formatDate(s.startDate)} to {formatDate(s.endDate)}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Duty Start Date</label>
                      <input type="date" {...regRequest('startDate')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Duty End Date</label>
                      <input type="date" {...regRequest('endDate')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Ticket: INDONESIA → ALGERIA</label>
                    <input type="date" {...regRequest('requestedDateIDtoDZ')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-emerald-500/30" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Ticket: ALGERIA → INDONESIA</label>
                    <input type="date" {...regRequest('requestedDateDZtoID')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-blue-500/30" />
                  </div>
                </div>
                {reqErrors.requestedDateDZtoID && <p className="text-[10px] text-rose-500 px-1">{reqErrors.requestedDateDZtoID.message}</p>}

                <div className="flex justify-end gap-3 pt-6">
                  <button type="button" onClick={handleCloseRequestModal} className="px-5 py-2 text-[11px] font-bold text-slate-500 hover:text-white uppercase transition-colors">Discard</button>
                  <button type="submit" className="btn-primary">
                    {editingFlight ? 'Update Request' : 'Submit Flight Request'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
        {isScheduleModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsScheduleModalOpen(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-[#111114] border border-white/10 p-8 rounded-2xl shadow-2xl">
              <h3 className="text-lg font-bold text-white uppercase tracking-tight mb-6">Duty Assignment</h3>
              <form onSubmit={handleSchedSubmit(onCreateSchedule)} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Staff Member</label>
                  <select {...regSched('personnelId')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-blue-500/30">
                    <option value="">Select Personnel...</option>
                    {personnel.map(p => <option key={p.id} value={p.id}>{p.fullName} ({p.employeeId})</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Commence</label>
                    <input type="date" {...regSched('startDate')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2 text-sm text-slate-300 rounded-lg" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Conclude</label>
                    <input type="date" {...regSched('endDate')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2 text-sm text-slate-300 rounded-lg" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Assignment Type</label>
                  <select {...regSched('status')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none">
                    <option value="ON_DUTY">ON DUTY</option>
                    <option value="OFF_DUTY">OFF DUTY</option>
                    <option value="TRANSIT">IN TRANSIT</option>
                  </select>
                </div>
                <div className="flex justify-end gap-3 pt-6">
                  <button type="button" onClick={() => setIsScheduleModalOpen(false)} className="px-5 py-2 text-[11px] font-bold text-slate-500 hover:text-white uppercase">Cancel</button>
                  <button type="submit" className="btn-primary">Deploy</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal 
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={handleDeleteRequest}
        title="Purge Transit Record"
        message="This operation will remove the flight request from the secure manifest database. This action is irreversible."
        confirmText="Confirm Purge"
      />
    </div>
  );
}
