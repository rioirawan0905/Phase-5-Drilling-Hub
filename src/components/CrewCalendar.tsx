import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Personnel, Scheduling, ScheduleStatus } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users, Clock, LayoutGrid, Plus, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from '../lib/utils';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const scheduleSchema = z.object({
  personnelIds: z.array(z.string()).min(1, 'At least one personnel is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  status: z.enum(['ON_DUTY', 'OFF_DUTY', 'TRANSIT'] as const),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;

type ViewMode = 'month' | 'week' | 'personnel' | 'gantt';

interface CrewCalendarProps {
  isGuest?: boolean;
}

export function CrewCalendar({ isGuest }: CrewCalendarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [schedules, setSchedules] = useState<Scheduling[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Scheduling | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'group'>('name');
  const [filterGroup, setFilterGroup] = useState<string>('ALL');
  const [filterPersonnel, setFilterPersonnel] = useState<string>('ALL');

  const groupColors: Record<string, string> = {
    'A': 'bg-blue-600',
    'B': 'bg-emerald-600',
    'C': 'bg-orange-600',
    'D': 'bg-purple-600',
    'E': 'bg-rose-600',
    'Group A': 'bg-blue-600',
    'Group B': 'bg-emerald-600',
    'Group C': 'bg-orange-600',
    'Group D': 'bg-purple-600',
    'Group E': 'bg-rose-600',
  };

  const getGroupColor = (group: string) => groupColors[group] || 'bg-slate-600';

  const getStatusColor = (status: ScheduleStatus) => {
    if (status === 'ON_DUTY') return 'shadow-lg shadow-black/20';
    if (status === 'TRANSIT') return 'opacity-60 ring-2 ring-white/20';
    return 'opacity-40 grayscale';
  };

  const sortedPersonnel = [...personnel]
    .filter(p => {
      if (filterGroup !== 'ALL' && p.rosterGroup !== filterGroup) return false;
      if (filterPersonnel !== 'ALL' && p.id !== filterPersonnel) return false;
      return true;
    })
    .sort((a, b) => {
    if (sortBy === 'name') return a.fullName.localeCompare(b.fullName);
    if (sortBy === 'group') return a.rosterGroup.localeCompare(b.rosterGroup);
    return 0;
  });

  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      const p = personnel.find(person => person.id === s.personnelId);
      if (!p) return false;
      if (filterGroup !== 'ALL' && p.rosterGroup !== filterGroup) return false;
      if (filterPersonnel !== 'ALL' && p.id !== filterPersonnel) return false;
      return true;
    });
  }, [schedules, personnel, filterGroup, filterPersonnel]);

  const uniqueGroups = useMemo(() => [...new Set(personnel.map(p => p.rosterGroup))].sort(), [personnel]);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { status: 'ON_DUTY', personnelIds: [] }
  });

  const watchPersonnelIds = watch('personnelIds');
  const watchStatus = watch('status');

  useEffect(() => {
    const unsubP = onSnapshot(collection(db, 'personnel'), (snap) => {
      setPersonnel(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Personnel)));
    });
    const unsubS = onSnapshot(collection(db, 'schedules'), (snap) => {
      setSchedules(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scheduling)));
    });
    return () => { unsubP(); unsubS(); };
  }, []);

  const onSaveSchedule = async (data: ScheduleFormData) => {
    try {
      if (editingSchedule) {
        // Since we are editing one, we take the first selected ID (should be exactly one)
        const updatedData = {
          personnelId: data.personnelIds[0],
          startDate: data.startDate,
          endDate: data.endDate,
          status: data.status
        };
        await updateDoc(doc(db, 'schedules', editingSchedule.id), updatedData);
      } else {
        // Multi-save
        const batch = data.personnelIds.map(pid => {
          return addDoc(collection(db, 'schedules'), {
            personnelId: pid,
            startDate: data.startDate,
            endDate: data.endDate,
            status: data.status,
            createdAt: new Date()
          });
        });
        await Promise.all(batch);
      }
      setIsModalOpen(false);
      setEditingSchedule(null);
      reset({ status: 'ON_DUTY', personnelIds: [] });
    } catch (error) {
      handleFirestoreError(error, editingSchedule ? OperationType.UPDATE : OperationType.CREATE, 'schedules');
    }
  };

  const handleOpenAdd = (dateStr?: string, pId?: string) => {
    if (isGuest) return;
    setEditingSchedule(null);
    reset({ 
      status: 'ON_DUTY', 
      startDate: dateStr || new Date().toISOString().split('T')[0], 
      endDate: dateStr || new Date().toISOString().split('T')[0],
      personnelIds: pId ? [pId] : []
    });
    setIsModalOpen(true);
  };

  const handleEdit = (s: Scheduling) => {
    if (isGuest) return;
    setEditingSchedule(s);
    reset({
      personnelIds: [s.personnelId],
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (isGuest) return;
    if (confirm('Delete this duty record?')) {
      await deleteDoc(doc(db, 'schedules', id));
    }
  };

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handlePrevWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    setCurrentDate(d);
  };

  const handleNextWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    setCurrentDate(d);
  };

  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    const days = [];

    // Empty cells for alignment
    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-24 bg-black/10 border border-white/5 opacity-20"></div>);
    }

    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const activeSchedules = filteredSchedules.filter(s => {
        const start = s.startDate;
        const end = s.endDate;
        return dateStr >= start && dateStr <= end;
      });

      days.push(
        <div 
          key={day} 
          className={cn(
            "h-28 bg-[#111114] border border-white/5 p-2 overflow-hidden flex flex-col hover:bg-white/[0.02] transition-colors group",
            isGuest ? "cursor-default" : "cursor-pointer"
          )}
          onClick={() => handleOpenAdd(dateStr)}
        >
          <div className="flex items-center justify-between mb-1">
             <span className="text-[10px] font-mono text-slate-500">{day}</span>
             {!isGuest && <Plus size={10} className="text-slate-700 opacity-0 group-hover:opacity-100" />}
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto custom-scrollbar">
            {activeSchedules.map(s => {
              const person = personnel.find(p => p.id === s.personnelId);
              return (
                <div 
                  key={s.id} 
                  onClick={(e) => { e.stopPropagation(); handleEdit(s); }}
                  className={cn(
                    "text-[8px] px-1.5 py-1 rounded-md truncate font-black uppercase tracking-tighter shadow-sm flex items-center gap-1.5 text-white border border-white/10 transition-colors",
                    getGroupColor(person?.rosterGroup || ''),
                    getStatusColor(s.status),
                    isGuest ? "cursor-default" : "cursor-pointer hover:border-white/30"
                  )}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 shrink-0" />
                  {person?.fullName || 'Crew'}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto custom-scrollbar">
        <div className="grid grid-cols-7 border-t border-l border-white/5 min-w-[700px]">
          {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => (
          <div key={d} className="bg-black/40 border-b border-r border-white/5 py-2 text-center text-[9px] font-bold text-slate-500 tracking-widest">{d}</div>
        ))}
        {days}
      </div>
    </div>
    );
  };

  const renderWeekView = () => {
    const today = new Date(currentDate);
    const day = today.getDay();
    const diff = today.getDate() - day; // Adjust to Sunday
    const startOfWeek = new Date(today.setDate(diff));
    
    const weekDays = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      return { date: d, dateStr };
    });

    return (
      <div className="overflow-x-auto custom-scrollbar">
        <div className="grid grid-cols-7 border-t border-l border-white/5 h-[600px] min-w-[700px]">
        {weekDays.map(({ date, dateStr }) => (
          <div 
            key={dateStr} 
            className={cn(
              "bg-[#111114] border-b border-r border-white/5 flex flex-col hover:bg-white/[0.01] transition-colors group",
              isGuest ? "cursor-default" : "cursor-pointer"
            )}
            onClick={() => handleOpenAdd(dateStr)}
          >
            <div className="bg-black/40 py-2 text-center border-b border-white/5 relative">
              <p className="text-[10px] font-bold text-slate-400 uppercase">{date.toLocaleDateString('default', { weekday: 'short' })}</p>
              <p className="text-[14px] font-mono text-white">{date.getDate()}</p>
              {!isGuest && <Plus size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 opacity-0 group-hover:opacity-100" />}
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto custom-scrollbar">
              {filteredSchedules.filter(s => dateStr >= s.startDate && dateStr <= s.endDate).map(s => {
                const person = personnel.find(p => p.id === s.personnelId);
                return (
                  <div 
                    key={s.id} 
                    onClick={(e) => { e.stopPropagation(); handleEdit(s); }}
                    className={cn(
                      "p-2 rounded-lg text-[9px] font-black uppercase tracking-widest text-white shadow-md border border-white/10 transition-all",
                      getGroupColor(person?.rosterGroup || ''),
                      getStatusColor(s.status),
                      isGuest ? "cursor-default" : "cursor-pointer hover:border-white/30"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span>{person?.fullName || 'Crew'}</span>
                      <span className="text-[7px] bg-white/20 px-1 rounded">{s.status}</span>
                    </div>
                    <p className="text-[7px] opacity-70 font-mono italic">{formatDate(s.startDate)} - {formatDate(s.endDate)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
    );
  };

  const renderPersonnelView = () => (
    <div className="space-y-4 max-h-[700px] overflow-y-auto custom-scrollbar pr-2">
      {sortedPersonnel.map(p => {
        const pSchedules = filteredSchedules.filter(s => s.personnelId === p.id).sort((a,b) => a.startDate.localeCompare(b.startDate));
        return (
          <div key={p.id} className="theme-card p-4 flex flex-col md:flex-row gap-6 items-start md:items-center group">
            <div className="w-48 shrink-0">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[var(--theme-text)] uppercase tracking-tight">{p.fullName}</h4>
                {!isGuest && (
                  <button 
                    onClick={() => handleOpenAdd(undefined, p.id)}
                    className="p-1 text-slate-600 hover:text-blue-400 opacity-0 group-hover:opacity-100"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                 <p className="text-[9px] text-slate-500 uppercase font-mono">{p.title}</p>
                 <span className={cn(
                   "text-[8px] px-1.5 py-0.5 rounded uppercase font-black border text-white",
                   getGroupColor(p.rosterGroup)
                 )}>
                   {p.rosterGroup}
                 </span>
              </div>
            </div>
            <div className="flex-1 flex gap-3 overflow-x-auto pb-4 custom-scrollbar">
              {pSchedules.length === 0 ? (
                <div className="flex items-center gap-3 py-2 opacity-30">
                  <Clock size={14} className="text-slate-500" />
                  <span className="text-[9px] text-slate-600 uppercase italic font-bold tracking-widest">No duty cycles assigned</span>
                </div>
              ) : (
                pSchedules.map(s => (
                  <div 
                    key={s.id} 
                    onClick={() => handleEdit(s)}
                    className={cn(
                      "bg-black/40 border border-white/10 px-4 py-3 rounded-xl shrink-0 min-w-[160px] relative overflow-hidden group/item transition-all",
                      isGuest ? "cursor-default" : "cursor-pointer hover:border-white/20"
                    )}
                  >
                    <div className={cn(
                      "absolute left-0 top-0 bottom-0 w-1",
                      s.status === 'ON_DUTY' ? "bg-emerald-500" : s.status === 'TRANSIT' ? "bg-blue-500" : "bg-slate-700"
                    )} />
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em]">{s.status}</p>
                      {!isGuest && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                          className="text-slate-800 hover:text-rose-500 opacity-0 group-hover/item:opacity-100 mt-[-4px]"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                       <p className="text-[11px] text-white font-mono flex items-center gap-2">
                         <span className="text-slate-600 text-[9px] font-bold">START:</span> {formatDate(s.startDate)}
                       </p>
                       <p className="text-[11px] text-white font-mono flex items-center gap-2 border-t border-white/5 pt-1 mt-1">
                         <span className="text-slate-600 text-[9px] font-bold">END:</span> {formatDate(s.endDate)}
                       </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderGanttView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    // Show 3 months for better scrollable Gantt context
    const monthsToShow = [
      new Date(year, month - 1, 1),
      new Date(year, month, 1),
      new Date(year, month + 1, 1)
    ];

    const dayWidth = 24; 
    const timelineDates: { date: Date, dateStr: string }[] = [];
    
    monthsToShow.forEach(m => {
       const days = daysInMonth(m.getFullYear(), m.getMonth());
       for(let i=1; i<=days; i++) {
         const d = new Date(m.getFullYear(), m.getMonth(), i);
         timelineDates.push({ date: d, dateStr: d.toISOString().split('T')[0] });
       }
    });

    return (
      <div className="overflow-x-auto custom-scrollbar border rounded-xl" style={{ backgroundColor: 'var(--theme-container)', borderColor: 'var(--theme-border)' }}>
        <div style={{ width: timelineDates.length * dayWidth + 200 }}>
          {/* Header */}
          <div className="flex border-b border-white/5 bg-black/60 sticky top-0 z-20">
            <div className="w-48 shrink-0 border-r border-white/5 p-3 text-[10px] font-black text-slate-400 bg-black/20 uppercase tracking-widest">Crew Roster</div>
            <div className="flex-1 flex overflow-hidden">
              {monthsToShow.map(m => {
                const days = daysInMonth(m.getFullYear(), m.getMonth());
                return (
                  <div key={m.getTime()} style={{ width: days * dayWidth }} className="shrink-0 text-center text-[9px] font-black text-slate-300 py-1 bg-white/[0.02] border-r border-white/5 uppercase">
                    {m.toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex border-b border-white/5 bg-black/40 sticky top-[25px] z-20">
            <div className="w-48 shrink-0 border-r border-white/5"></div>
            <div className="flex-1 flex">
              {timelineDates.map(({ date }, i) => (
                <div key={i} style={{ width: dayWidth }} className={cn(
                  "shrink-0 text-center text-[8px] font-bold py-1 border-r border-white/5",
                  date.getDay() === 0 || date.getDay() === 6 ? "bg-white/[0.03] text-slate-400" : "text-slate-600"
                )}>
                  {date.getDate()}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-white/5">
            {sortedPersonnel.map(p => (
              <div key={p.id} className="flex group hover:bg-white/[0.01]">
                <div className="w-48 shrink-0 border-r border-white/5 p-3 bg-black/10">
                  <p className="text-[10px] font-bold text-[var(--theme-text)] uppercase truncate">{p.fullName}</p>
                  <p className={cn(
                    "text-[8px] px-1.5 rounded-sm w-fit font-mono uppercase font-black mt-0.5 text-white",
                    getGroupColor(p.rosterGroup)
                  )}>{p.rosterGroup}</p>
                </div>
                <div className="flex-1 relative flex h-12 items-center">
                  {filteredSchedules.filter(s => s.personnelId === p.id).map(s => {
                    const findIndex = (dateStr: string) => timelineDates.findIndex(td => td.dateStr === dateStr);
                    let startIdx = findIndex(s.startDate);
                    let endIdx = findIndex(s.endDate);
                    
                    if (startIdx === -1 && endIdx === -1) return null;
                    if (startIdx === -1) startIdx = 0;
                    if (endIdx === -1) endIdx = timelineDates.length - 1;

                    const left = startIdx * dayWidth;
                    const width = (endIdx - startIdx + 1) * dayWidth;

                    return (
                      <div 
                        key={s.id}
                        style={{ left, width }}
                        className={cn(
                          "absolute h-6 rounded flex items-center justify-center px-1 group/bar overflow-hidden border border-white/10 text-white",
                          getGroupColor(p.rosterGroup),
                          getStatusColor(s.status)
                        )}
                      >
                        <span className="text-[7px] text-white font-black uppercase tracking-[0.1em] transition-opacity whitespace-nowrap">
                          {s.status === 'TRANSIT' ? 'TRANS' : s.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 md:gap-6 mb-8">
        <div className="flex flex-wrap gap-2 order-2 xl:order-1">
          {(['month', 'week', 'personnel', 'gantt'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "px-3 md:px-5 py-2 md:py-2.5 rounded-xl flex items-center gap-2 md:gap-3 text-[8px] md:text-[10px] font-black uppercase tracking-widest transition-all border shadow-lg flex-1 md:flex-none justify-center",
                viewMode === mode 
                  ? "bg-blue-600 border-blue-400 text-white shadow-blue-500/25" 
                  : "bg-theme-container border-white/5 text-slate-500 hover:text-slate-300 hover:bg-white/5"
              )}
            >
              <div className="hidden xs:block">
                {mode === 'month' && <CalendarIcon size={14} />}
                {mode === 'week' && <Clock size={14} />}
                {mode === 'personnel' && <Users size={14} />}
                {mode === 'gantt' && <LayoutGrid size={14} />}
              </div>
              <span>{mode}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between xl:justify-end gap-4 order-1 xl:order-2 w-full xl:w-auto">
          <div className="flex items-center gap-2 md:gap-4 flex-1 xl:flex-none justify-between md:justify-start">
            <h3 className="text-xs md:text-sm font-bold text-[var(--theme-text)] uppercase tracking-widest text-center min-w-[120px] md:min-w-[150px]">
              {viewMode === 'week' 
                ? `WK OF ${currentDate.toLocaleDateString('default', { month: 'short', day: 'numeric' })}`
                : currentDate.toLocaleString('default', { month: 'short', year: 'numeric' })
              }
            </h3>
            <div className="flex gap-1 shrink-0">
              <button onClick={viewMode === 'week' ? handlePrevWeek : handlePrevMonth} className="p-1.5 md:p-2 border rounded-lg transition-all" style={{ backgroundColor: 'var(--theme-container)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}><ChevronLeft size={14} /></button>
              <button onClick={viewMode === 'week' ? handleNextWeek : handleNextMonth} className="p-1.5 md:p-2 border rounded-lg transition-all" style={{ backgroundColor: 'var(--theme-container)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}><ChevronRight size={14} /></button>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-black/40 border border-white/5 rounded-xl">
               <span className="text-[10px] font-black text-slate-500 uppercase">Group</span>
               <select 
                 value={filterGroup} 
                 onChange={(e) => setFilterGroup(e.target.value)}
                 className="bg-transparent text-white text-[11px] font-bold uppercase focus:outline-none cursor-pointer max-w-[80px]"
               >
                 <option value="ALL">ALL</option>
                 {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
               </select>
            </div>
            <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-black/40 border border-white/5 rounded-xl">
               <span className="text-[10px] font-black text-slate-500 uppercase">Staff</span>
               <select 
                 value={filterPersonnel} 
                 onChange={(e) => setFilterPersonnel(e.target.value)}
                 className="bg-transparent text-white text-[11px] font-bold uppercase focus:outline-none cursor-pointer max-w-[100px]"
               >
                 <option value="ALL">ALL</option>
                 {personnel.sort((a,b) => a.fullName.localeCompare(b.fullName)).map(p => (
                   <option key={p.id} value={p.id}>{p.fullName}</option>
                 ))}
               </select>
            </div>
            <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-black/40 border border-white/5 rounded-xl">
               <span className="text-[10px] font-black text-slate-500 uppercase">Sort</span>
               <select 
                 value={sortBy} 
                 onChange={(e) => setSortBy(e.target.value as 'name' | 'group')}
                 className="bg-transparent text-white text-[11px] font-bold uppercase focus:outline-none cursor-pointer"
               >
                 <option value="name">Name</option>
                 <option value="group">Group</option>
               </select>
            </div>
            {!isGuest && (
              <button 
                onClick={() => handleOpenAdd()}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 md:px-4 py-2 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-[0.1em] transition-all shadow-lg shadow-blue-900/40"
              >
                <Plus size={14} /> <span className="hidden xs:inline">Add Duty</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main View Area */}
      <div className="theme-container overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={viewMode + currentDate.getTime()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
          >
            {viewMode === 'month' && renderMonthView()}
            {viewMode === 'week' && renderWeekView()}
            {viewMode === 'personnel' && renderPersonnelView()}
            {viewMode === 'gantt' && renderGanttView()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Schedule Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="relative w-full max-w-md bg-[#16161a] border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white uppercase tracking-widest flex items-center gap-3">
                  <CalendarIcon size={18} className="text-blue-500" />
                  {editingSchedule ? 'Edit Duty Period' : 'Assign Duty Period'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSaveSchedule)} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Select Personnel (Multi-select enabled)</label>
                  <div className="max-h-[150px] overflow-y-auto custom-scrollbar border border-white/5 bg-[#0a0a0c] rounded-lg p-2 space-y-1">
                    {personnel.map(p => (
                      <label key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5 cursor-pointer transition-colors group">
                        <input 
                          type="checkbox" 
                          value={p.id} 
                          checked={watchPersonnelIds?.includes(p.id)}
                          onChange={(e) => {
                            const current = watchPersonnelIds || [];
                            if (e.target.checked) {
                              setValue('personnelIds', [...current, p.id]);
                            } else {
                              setValue('personnelIds', current.filter(id => id !== p.id));
                            }
                          }}
                          disabled={!!editingSchedule}
                          className="w-4 h-4 rounded border-white/10 bg-black text-blue-600 focus:ring-0 focus:ring-offset-0"
                        />
                        <div className="flex flex-col">
                           <span className="text-[11px] font-bold text-slate-300 group-hover:text-white transition-colors">{p.fullName}</span>
                           <span className="text-[9px] text-slate-600 uppercase font-mono">{p.rosterGroup} • {p.title}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  {errors.personnelIds && <p className="text-[10px] text-rose-500 px-1">{errors.personnelIds.message}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Start Date</label>
                    <input type="date" {...register('startDate')} className="w-full bg-[#0a0a0c] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-blue-500/30" />
                    {errors.startDate && <p className="text-[10px] text-rose-500 px-1">{errors.startDate.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">End Date</label>
                    <input type="date" {...register('endDate')} className="w-full bg-[#0a0a0c] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-blue-500/30" />
                    {errors.endDate && <p className="text-[10px] text-rose-500 px-1">{errors.endDate.message}</p>}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Duty Status</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['ON_DUTY', 'TRANSIT', 'OFF_DUTY'] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setValue('status', s)}
                        className={cn(
                          "py-2 rounded-lg text-[9px] font-black uppercase tracking-tighter transition-all border",
                          watchStatus === s 
                            ? (s === 'ON_DUTY' ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" : s === 'TRANSIT' ? "bg-blue-500/20 border-blue-500 text-blue-400" : "bg-slate-500/20 border-slate-500 text-slate-400")
                            : "bg-black/40 border-white/5 text-slate-600 hover:border-white/20"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <input type="hidden" {...register('status')} />
                </div>

                <div className="flex gap-3 pt-6 border-t border-white/5 mt-6">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-3 rounded-xl bg-black border border-white/5 text-slate-400 text-xs font-bold uppercase tracking-widest hover:text-white transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-3 rounded-xl bg-blue-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/40"
                  >
                    {editingSchedule ? 'Update Duty' : 'Save Duty'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
