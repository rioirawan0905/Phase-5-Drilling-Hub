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

  // Filters State
  const [filterMonth, setFilterMonth] = useState<string>('ALL');
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [filterGroup, setFilterGroup] = useState<string>('ALL');
  const [filterPersonnel, setFilterPersonnel] = useState<string>('ALL');

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
    if (status === 'Received') return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    
    // Explicit or Auto "Need Action" logic
    let isUrgent = status === 'Need Action';
    if (requestedDate) {
      const flightDate = new Date(requestedDate);
      const today = new Date();
      const diffTime = flightDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 14) isUrgent = true;
    }

    if (isUrgent) {
      return "bg-rose-500/20 text-rose-500 border-rose-500/30 animate-pulse font-bold px-2 py-0.5 rounded";
    }

    if (status === 'Not Requested') return "bg-slate-500/10 text-slate-500 border-white/5 px-2 py-0.5 rounded";
    return "bg-blue-500/20 text-blue-400 border-blue-500/30 font-bold px-2 py-0.5 rounded text-center min-w-[70px]";
  };

  const getStatusLabel = (status: FlightStatus, requestedDate?: string | null) => {
    if (status === 'Received') return "Received";
    
    if (requestedDate) {
      const flightDate = new Date(requestedDate);
      const today = new Date();
      const diffTime = flightDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
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
    return flights.filter(f => {
      const person = personnel.find(p => p.id === f.personnelId);
      
      // Personnel filter
      if (filterPersonnel !== 'ALL' && f.personnelId !== filterPersonnel) return false;
      
      // Group filter
      if (filterGroup !== 'ALL' && person?.rosterGroup !== filterGroup) return false;
      
      // Year filter (checking duty period and flight dates)
      const flightDates = [f.startDate, f.endDate, f.requestedDateDZtoID, f.requestedDateIDtoDZ].filter(Boolean) as string[];
      if (filterYear !== 'ALL') {
        const hasYear = flightDates.some(d => d.startsWith(filterYear));
        if (!hasYear) return false;
      }
      
      // Month filter
      if (filterMonth !== 'ALL') {
        const monthNum = parseInt(filterMonth);
        const hasMonth = flightDates.some(d => {
          if (!d) return false;
          // Simple string check is usually enough if format is YYYY-MM-DD
          return d.split('-')[1] === filterMonth.padStart(2, '0');
        });
        if (!hasMonth) return false;
      }
      
      return true;
    });
  }, [flights, personnel, filterMonth, filterYear, filterGroup, filterPersonnel]);

  const uniqueGroups = useMemo(() => {
    const groups = new Set(personnel.map(p => p.rosterGroup).filter(Boolean));
    return Array.from(groups).sort();
  }, [personnel]);

  return (
    <div className="space-y-4 md:space-y-6 pb-20">
      {/* View Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-xs md:text-sm font-semibold uppercase tracking-wider text-white">Flight Ticket Request</h2>
          <p className="text-[9px] md:text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Manifest Terminal</p>
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
      <div className="flex flex-col gap-4 p-3 md:p-4 bg-black/20 border border-white/5 rounded-xl">
        <div className="flex items-center gap-2">
          <Filter size={12} className="text-slate-500" />
          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Filters</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 flex-1">
          <div className="space-y-1">
            <label className="text-[8px] text-slate-500 uppercase font-bold px-1">Month</label>
            <select 
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="w-full bg-[#111114] border border-white/5 px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-slate-300 rounded-lg focus:outline-none"
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
            <label className="text-[8px] text-slate-500 uppercase font-bold px-1">Year</label>
            <select 
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="w-full bg-[#111114] border border-white/5 px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-slate-300 rounded-lg focus:outline-none"
            >
              <option value="ALL">ALL YEARS</option>
              <option value="2024">2024</option>
              <option value="2025">2025</option>
              <option value="2026">2026</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] text-slate-500 uppercase font-bold px-1">Group</label>
            <select 
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="w-full bg-[#111114] border border-white/5 px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-slate-300 rounded-lg focus:outline-none"
            >
              <option value="ALL">ALL GROUPS</option>
              {uniqueGroups.map(g => (
                <option key={g} value={g}>GROUP {g}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] text-slate-500 uppercase font-bold px-1">Personnel</label>
            <select 
              value={filterPersonnel}
              onChange={(e) => setFilterPersonnel(e.target.value)}
              className="w-full bg-[#111114] border border-white/5 px-2 md:px-3 py-1.5 text-[9px] md:text-[10px] text-slate-300 rounded-lg focus:outline-none"
            >
              <option value="ALL">ALL PERSONNEL</option>
              {personnel.sort((a,b) => a.fullName.localeCompare(b.fullName)).map(p => (
                <option key={p.id} value={p.id}>{p.fullName}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Flight Manifest Theme Container */}
      <div className="theme-container overflow-hidden">
        <div className="overflow-x-auto md:overflow-x-visible custom-scrollbar">
          {/* Desktop Table */}
          <table className="hidden md:table w-full text-left min-w-[800px] md:min-w-0">
          <thead className="text-[10px] text-slate-500 uppercase tracking-widest bg-black/20">
            <tr>
              <th className="py-3 px-6 font-normal">Personnel</th>
              <th className="py-3 px-6 font-normal">Duty Period</th>
              <th className="py-3 px-6 font-normal">Transit Route / Leg Control</th>
              <th className="py-3 px-6 font-normal text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-xs divide-y divide-white/5">
            {filteredFlights.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-20 text-center text-[10px] uppercase font-mono text-slate-700 tracking-widest">
                  No active requests in system
                </td>
              </tr>
            ) : (
              filteredFlights.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map((f) => {
                const person = personnel.find(p => p.id === f.personnelId);
                return (
                  <tr key={f.id} className="hover:bg-white/[0.02] transition-colors group border-b border-white/5">
                    <td className="py-4 px-6 align-top">
                      <p className="font-semibold text-white">{person?.fullName || 'UNKNOWN'}</p>
                      <p className="text-[10px] text-slate-500 font-mono italic">{person?.title || 'No Title'}</p>
                      <div className="mt-2 text-[8px] font-mono text-slate-700">ID-{f.id.slice(0,8).toUpperCase()}</div>
                    </td>
                    <td className="py-4 px-6 text-slate-400 font-mono whitespace-nowrap align-top">
                      <div className="flex items-center gap-2">
                        <Calendar size={10} className="text-slate-700" />
                        {f.startDate ? `${formatDate(f.startDate)} — ${formatDate(f.endDate)}` : 'N/A'}
                      </div>
                    </td>
                    <td className="py-4 px-6 align-top">
                      <div className="space-y-3 min-w-[400px]">
                        {f.requestedDateIDtoDZ && (
                          <div className="flex items-center justify-between p-2 rounded bg-emerald-500/5 border border-emerald-500/10">
                            <div className="flex items-center gap-3">
                              <ArrowLeft size={12} className="text-emerald-400" />
                              <div>
                                <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Indonesia → Algeria</p>
                                <p className="text-[11px] text-white font-mono">{formatDate(f.requestedDateIDtoDZ)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border",
                                getStatusLabel(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ) === 'Need Action'
                                  ? "bg-rose-500/20 text-rose-500 border-rose-500/30 animate-pulse font-bold"
                                  : f.statusIDtoDZ === 'Received'
                                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                    : "bg-emerald-500/5 text-emerald-400 border-emerald-500/10"
                              )}>
                                {getStatusLabel(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ)}
                              </span>
                              {!isGuest ? (
                                <select 
                                  onChange={(e) => updateTransitStatus(f.id, 'IDtoDZ', e.target.value as FlightStatus)}
                                  value={f.statusIDtoDZ || 'Requested'}
                                  className="bg-black/40 border border-white/5 text-[9px] text-slate-400 px-2 py-1 rounded focus:outline-none focus:border-emerald-500/30 font-bold uppercase"
                                >
                                  <option value="Not Requested">Not Requested</option>
                                  <option value="Requested">Requested</option>
                                  <option value="Received">Received</option>
                                </select>
                              ) : (
                                <span className="text-[9px] text-slate-500 font-bold uppercase">Locked</span>
                              )}
                            </div>
                          </div>
                        )}
                        {f.requestedDateDZtoID && (
                          <div className="flex items-center justify-between p-2 rounded bg-blue-500/5 border border-blue-500/10">
                            <div className="flex items-center gap-3">
                              <ArrowRight size={12} className="text-blue-400" />
                              <div>
                                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Algeria → Indonesia</p>
                                <p className="text-[11px] text-white font-mono">{formatDate(f.requestedDateDZtoID)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border",
                                getStatusLabel(f.statusDZtoID || 'Requested', f.requestedDateDZtoID) === 'Need Action'
                                  ? "bg-rose-500/20 text-rose-500 border-rose-500/30 animate-pulse font-bold"
                                  : f.statusDZtoID === 'Received'
                                    ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                                    : "bg-blue-500/5 text-blue-400 border-blue-500/10"
                              )}>
                                {getStatusLabel(f.statusDZtoID || 'Requested', f.requestedDateDZtoID)}
                              </span>
                              {!isGuest ? (
                                <select 
                                  onChange={(e) => updateTransitStatus(f.id, 'DZtoID', e.target.value as FlightStatus)}
                                  value={f.statusDZtoID || 'Requested'}
                                  className="bg-black/40 border border-white/5 text-[9px] text-slate-400 px-2 py-1 rounded focus:outline-none focus:border-blue-500/30 font-bold uppercase"
                                >
                                  <option value="Not Requested">Not Requested</option>
                                  <option value="Requested">Requested</option>
                                  <option value="Received">Received</option>
                                </select>
                              ) : (
                                <span className="text-[9px] text-slate-500 font-bold uppercase">Locked</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-right whitespace-nowrap">
                      {!isGuest && (
                        <div className="flex flex-col items-end gap-2">
                           <button onClick={() => handleEditFlight(f)} className="p-1 px-2 text-[10px] font-bold text-slate-500 hover:text-white uppercase flex items-center gap-1 border border-white/5 rounded w-fit"><Pencil size={11} /> Edit</button>
                           <button onClick={() => setDeleteConfirmId(f.id)} className="p-1 px-2 text-[10px] font-bold text-slate-500 hover:text-rose-500 uppercase flex items-center gap-1 border border-white/5 rounded w-fit"><Trash2 size={11} /> Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>

        {/* Mobile View */}
        <div className="md:hidden divide-y divide-white/5">
          {filteredFlights.length === 0 ? (
            <div className="py-12 text-center text-[10px] uppercase font-mono text-slate-700 tracking-widest px-4">
              No active requests in system
            </div>
          ) : (
            filteredFlights.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map((f) => {
              const person = personnel.find(p => p.id === f.personnelId);
              return (
                <div key={f.id} className="p-4 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold text-sm text-white uppercase tracking-tight">{person?.fullName || 'UNKNOWN'}</p>
                      <p className="text-[10px] text-slate-500 font-mono italic">{person?.title}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-[8px] font-mono text-slate-700">ID-{f.id.slice(0,6).toUpperCase()}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono bg-white/[0.02] p-2 rounded">
                    <Calendar size={12} className="text-slate-700" />
                    {f.startDate ? `${formatDate(f.startDate)} — ${formatDate(f.endDate)}` : 'DATE N/A'}
                  </div>

                  <div className="space-y-3">
                    {f.requestedDateIDtoDZ && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ArrowLeft size={10} className="text-emerald-400" />
                            <span className="text-[9px] font-black text-emerald-400 uppercase">ID → ALG</span>
                          </div>
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[8px] font-black uppercase border",
                            getStatusLabel(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ) === 'Need Action'
                              ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          )}>
                            {getStatusLabel(f.statusIDtoDZ || 'Requested', f.requestedDateIDtoDZ)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-300 font-mono">{formatDate(f.requestedDateIDtoDZ)}</span>
                          {!isGuest && (
                            <select 
                              onChange={(e) => updateTransitStatus(f.id, 'IDtoDZ', e.target.value as FlightStatus)}
                              value={f.statusIDtoDZ || 'Requested'}
                              className="bg-black/40 border border-white/5 text-[9px] text-slate-400 px-2 py-1 rounded font-bold uppercase"
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
                      <div className="space-y-2 pt-2 border-t border-white/5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ArrowRight size={10} className="text-blue-400" />
                            <span className="text-[9px] font-black text-blue-400 uppercase">ALG → ID</span>
                          </div>
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[8px] font-black uppercase border",
                            getStatusLabel(f.statusDZtoID || 'Requested', f.requestedDateDZtoID) === 'Need Action'
                              ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                              : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          )}>
                            {getStatusLabel(f.statusDZtoID || 'Requested', f.requestedDateDZtoID)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-300 font-mono">{formatDate(f.requestedDateDZtoID)}</span>
                          {!isGuest && (
                            <select 
                              onChange={(e) => updateTransitStatus(f.id, 'DZtoID', e.target.value as FlightStatus)}
                              value={f.statusDZtoID || 'Requested'}
                              className="bg-black/40 border border-white/5 text-[9px] text-slate-400 px-2 py-1 rounded font-bold uppercase"
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

                  {!isGuest && (
                    <div className="flex justify-end gap-3 pt-2">
                       <button onClick={() => handleEditFlight(f)} className="p-1 px-3 text-[10px] font-bold text-slate-500 hover:text-white uppercase flex items-center gap-1 border border-white/5 rounded bg-white/5"><Pencil size={11} /> Edit</button>
                       <button onClick={() => setDeleteConfirmId(f.id)} className="p-1 px-3 text-[10px] font-bold text-slate-500 hover:text-rose-500 uppercase flex items-center gap-1 border border-white/5 rounded bg-white/5"><Trash2 size={11} /> Delete</button>
                    </div>
                  )}
                </div>
              )
            })
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
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Ticket: ID → DZ</label>
                    <input type="date" {...regRequest('requestedDateIDtoDZ')} className="w-full bg-[#16161a] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-emerald-500/30" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Ticket: DZ → ID</label>
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
