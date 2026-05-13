import { useState, useEffect, useMemo, MouseEvent } from 'react';
import { collection, onSnapshot, query, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Personnel, Scheduling, ScheduleStatus, HubEvent } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users, Clock, LayoutGrid, Plus, Trash2, X, AlertCircle, Wrench, Info, Palmtree, Tag } from 'lucide-react';
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

const eventSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  location: z.enum(['Algiers', 'Hassi Messaoud', 'MLN', 'Other'] as const),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  type: z.enum(['general', 'meeting', 'walkthrough', 'holiday'] as const),
  recurrence: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']),
  recurrenceDays: z.array(z.number()).optional(), // 0-6 for Sun-Sat
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;
type EventFormData = z.infer<typeof eventSchema>;

function toLocalDateStr(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const eventTypeColors: Record<string, { bg: string, text: string, border: string, solid: string }> = {
  general: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', solid: 'bg-blue-600' },
  meeting: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', solid: 'bg-amber-600' },
  walkthrough: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30', solid: 'bg-purple-600' },
  holiday: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', solid: 'bg-emerald-600' },
};

type ViewMode = 'month' | 'week' | 'personnel' | 'gantt';

interface CrewCalendarProps {
  isGuest?: boolean;
}

export function CrewCalendar({ isGuest }: CrewCalendarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [schedules, setSchedules] = useState<Scheduling[]>([]);
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Scheduling | null>(null);
  const [editingEvent, setEditingEvent] = useState<HubEvent | null>(null);
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

  const { register: registerEvent, handleSubmit: handleSubmitEvent, reset: resetEvent, setValue: setEventValue, watch: watchEvent, formState: { errors: eventErrors } } = useForm<EventFormData>({
    resolver: zodResolver(eventSchema),
    defaultValues: { type: 'general', recurrence: 'none', recurrenceDays: [] }
  });

  const watchPersonnelIds = watch('personnelIds');
  const watchStatus = watch('status');
  const watchEventType = watchEvent('type');
  const watchRecurrence = watchEvent('recurrence');
  const watchRecurrenceDays = watchEvent('recurrenceDays');

  useEffect(() => {
    const unsubP = onSnapshot(collection(db, 'personnel'), (snap) => {
      setPersonnel(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Personnel)));
    });
    const unsubS = onSnapshot(collection(db, 'schedules'), (snap) => {
      setSchedules(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scheduling)));
    });
    const unsubE = onSnapshot(collection(db, 'events'), (snap) => {
      setEvents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HubEvent)));
    });
    return () => { unsubP(); unsubS(); unsubE(); };
  }, []);

  const onSaveEvent = async (data: EventFormData) => {
    try {
      if (editingEvent) {
        await updateDoc(doc(db, 'events', editingEvent.id), data);
      } else {
        if (data.recurrence === 'none') {
          await addDoc(collection(db, 'events'), { ...data, createdAt: new Date() });
        } else {
          // Generate recurring events
          const eventsToCreate = [];
          const seriesStart = new Date(data.startDate);
          const seriesEnd = new Date(data.endDate);
          
          let current = new Date(seriesStart);
          // If monthly, keep the original day
          const originalDay = seriesStart.getDate();

          while (current <= seriesEnd) {
            // Check if this specific day is allowed if recurrenceDays is set
            const dayOfWeek = current.getDay();
            const isAllowedDay = !data.recurrenceDays || data.recurrenceDays.length === 0 || data.recurrenceDays.includes(dayOfWeek);

            if (isAllowedDay) {
              eventsToCreate.push({
                ...data,
                startDate: toLocalDateStr(current),
                endDate: toLocalDateStr(current), // Assume 1-day events for recurrence
                createdAt: new Date()
              });
            }

            if (data.recurrence === 'daily') {
              current.setDate(current.getDate() + 1);
            } else if (data.recurrence === 'weekly') {
              current.setDate(current.getDate() + 7);
            } else if (data.recurrence === 'biweekly') {
              current.setDate(current.getDate() + 14);
            } else if (data.recurrence === 'monthly') {
               current.setMonth(current.getMonth() + 1);
               current.setDate(originalDay);
            } else {
              break;
            }
          }

          if (eventsToCreate.length === 0) {
             throw new Error('No events generated for the selected recurrence and days');
          }

          const batch = eventsToCreate.map(ev => addDoc(collection(db, 'events'), ev));
          await Promise.all(batch);
        }
      }
      setIsEventModalOpen(false);
      setEditingEvent(null);
      resetEvent({ type: 'general', title: '', description: '', startDate: '', endDate: '', recurrence: 'none', recurrenceDays: [] });
    } catch (error) {
       console.error("Save Event Error:", error);
       handleFirestoreError(error, editingEvent ? OperationType.UPDATE : OperationType.CREATE, 'events');
    }
  };

  const handleOpenAddEvent = (dateStr?: string) => {
    if (isGuest) return;
    setEditingEvent(null);
    resetEvent({ 
      type: 'general', 
      title: '',
      description: '',
      location: 'MLN',
      startDate: dateStr || toLocalDateStr(new Date()), 
      endDate: dateStr || toLocalDateStr(new Date()),
      recurrence: 'none',
      recurrenceDays: []
    });
    setIsEventModalOpen(true);
  };

  const handleEditEvent = (ev: HubEvent) => {
    if (isGuest) return;
    setEditingEvent(ev);
    resetEvent({
      title: ev.title,
      description: ev.description || '',
      location: (ev as any).location || 'MLN',
      startDate: ev.startDate,
      endDate: ev.endDate,
      type: ev.type,
      recurrence: (ev as any).recurrence || 'none',
      recurrenceDays: (ev as any).recurrenceDays || []
    });
    setIsEventModalOpen(true);
  };

  const handleDeleteEvent = async (id: string, e?: MouseEvent) => {
    if (e) e.stopPropagation();
    if (isGuest) return;
    try {
      if (confirm('Are you sure you want to delete this event? This action cannot be undone.')) {
        console.log("Deleting event:", id);
        await deleteDoc(doc(db, 'events', id));
        setIsEventModalOpen(false);
        setEditingEvent(null);
      }
    } catch (error) {
      console.error("Delete Event Error:", error);
      handleFirestoreError(error, OperationType.DELETE, 'events');
    }
  };

  const getEventIcon = (type: HubEvent['type'], size = 12) => {
    switch(type) {
      case 'meeting': return <Clock size={size} className="text-amber-400" />;
      case 'walkthrough': return <Users size={size} className="text-purple-400" />;
      case 'holiday': return <Palmtree size={size} className="text-emerald-400" />;
      default: return <Info size={size} className="text-blue-400" />;
    }
  };

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
      startDate: dateStr || toLocalDateStr(new Date()), 
      endDate: dateStr || toLocalDateStr(new Date()),
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
      const dateStr = toLocalDateStr(new Date(year, month, day));
      const activeSchedules = filteredSchedules.filter(s => {
        const start = s.startDate;
        const end = s.endDate;
        return dateStr >= start && dateStr <= end;
      });
      const activeEvents = events.filter(e => dateStr >= e.startDate && dateStr <= e.endDate);

      days.push(
        <div 
          key={day} 
          className={cn(
            "h-28 bg-[#111114] border border-white/5 p-2 overflow-hidden flex flex-col hover:bg-white/[0.02] transition-colors group",
            isGuest ? "cursor-default" : "cursor-default"
          )}
        >
          <div className="flex items-center justify-between mb-1">
             <span className="text-[10px] font-mono text-slate-500">{day}</span>
             {!isGuest && (
               <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                 <button onClick={() => handleOpenAdd(dateStr)} className="p-0.5 hover:text-blue-500 text-slate-700 transition-colors" title="Add Duty"><Plus size={10} /></button>
                 <button onClick={() => handleOpenAddEvent(dateStr)} className="p-0.5 hover:text-emerald-500 text-slate-700 transition-colors" title="Add Event"><Tag size={8} /></button>
               </div>
             )}
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto custom-scrollbar">
            {activeEvents.map(ev => {
              const colors = eventTypeColors[ev.type] || eventTypeColors.general;
              return (
                <div 
                  key={ev.id}
                  onClick={(e) => { e.stopPropagation(); handleEditEvent(ev); }}
                  className={cn(
                    "text-[8px] px-1.5 py-0.5 rounded flex items-center gap-1 font-bold border transition-all",
                    colors.bg, colors.text, colors.border,
                    isGuest ? "cursor-default" : "cursor-pointer hover:border-white/20"
                  )}
                  title={`${ev.title}${ev.description ? `: ${ev.description}` : ''}`}
                >
                  {getEventIcon(ev.type, 8)}
                  <span className="truncate">{ev.title}</span>
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-0 mb-2 w-32 bg-slate-900 p-2 rounded-xl border border-white/10 text-[7px] invisible group-hover/event:visible z-50 shadow-2xl">
                    <div className={cn("w-full h-0.5 absolute top-0 left-0 rounded-t-xl", colors.solid)} />
                    <p className="font-bold border-b border-white/10 pb-1 mb-1 text-white">{ev.title}</p>
                    <p className="opacity-70 leading-tight text-slate-300">{ev.description || 'No description'}</p>
                  </div>
                </div>
              );
            })}
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
      <div className="overflow-x-auto md:overflow-x-visible custom-scrollbar">
        <div className="grid grid-cols-7 border-t border-l border-white/5 min-w-[320px] md:min-w-0">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => (
            <div key={`${d}-${idx}`} className="bg-black/40 border-b border-r border-white/5 py-2 text-center text-[8px] md:text-[9px] font-black text-slate-500 tracking-widest">{d}</div>
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
      const dateStr = toLocalDateStr(d);
      return { date: d, dateStr };
    });

    return (
      <div className="overflow-x-auto md:overflow-x-visible custom-scrollbar">
        <div className="grid grid-cols-7 border-t border-l border-white/5 h-[450px] md:h-[600px] min-w-[320px] md:min-w-0">
        {weekDays.map(({ date, dateStr }) => (
          <div 
            key={dateStr} 
            className={cn(
              "bg-[#111114] border-b border-r border-white/5 flex flex-col hover:bg-white/[0.01] transition-colors group",
              isGuest ? "cursor-default" : "cursor-default"
            )}
          >
            <div className="bg-black/40 py-2 text-center border-b border-white/5 relative">
              <p className="text-[10px] font-bold text-slate-400 uppercase">{date.toLocaleDateString('default', { weekday: 'short' })}</p>
              <p className="text-[14px] font-mono text-white">{date.getDate()}</p>
              {!isGuest && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleOpenAdd(dateStr)} className="p-1 hover:text-blue-500 text-slate-700" title="Add Duty"><Plus size={12} /></button>
                  <button onClick={() => handleOpenAddEvent(dateStr)} className="p-1 hover:text-emerald-500 text-slate-700" title="Add Event"><Tag size={10} /></button>
                </div>
              )}
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto custom-scrollbar">
              {events.filter(e => dateStr >= e.startDate && dateStr <= e.endDate).map(ev => {
                const colors = eventTypeColors[ev.type] || eventTypeColors.general;
                return (
                  <div 
                    key={ev.id}
                    onClick={(e) => { e.stopPropagation(); handleEditEvent(ev); }}
                    className={cn(
                      "p-1.5 rounded-lg border flex items-center gap-2 group/event relative cursor-pointer transition-all",
                      colors.bg, colors.border,
                      isGuest ? "cursor-default" : "hover:border-white/20"
                    )}
                  >
                    {getEventIcon(ev.type, 10)}
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-[8px] font-bold truncate", colors.text)}>{ev.title}</p>
                    </div>
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full left-0 mb-2 w-40 bg-slate-900 p-2 rounded-xl border border-white/10 text-[8px] invisible group-hover/event:visible z-50 shadow-2xl">
                      <div className={cn("w-full h-0.5 absolute top-0 left-0 rounded-t-xl", colors.solid)} />
                      <p className="font-bold border-b border-white/10 pb-1 mb-1 text-white">{ev.title}</p>
                      <p className="text-slate-400 leading-tight">{ev.description || 'No description provided'}</p>
                      <p className="text-[7px] text-slate-600 mt-2 font-mono uppercase">{formatDate(ev.startDate)} - {formatDate(ev.endDate)}</p>
                    </div>
                    {!isGuest && (
                      <button onClick={(e) => handleDeleteEvent(ev.id, e)} className="opacity-0 group-hover/event:opacity-100 hover:text-rose-500 text-slate-700 transition-opacity">
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                );
              })}
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
      {/* Hub Events Timeline */}
      {events.length > 0 && (
        <div className="theme-card p-4 border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center justify-between mb-4">
             <h4 className="text-xs font-black text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-2">
               <Tag size={14} /> Global Hub Events
             </h4>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
            {events.sort((a,b) => a.startDate.localeCompare(b.startDate)).map(ev => {
              const colors = eventTypeColors[ev.type] || eventTypeColors.general;
              return (
                <div 
                  key={ev.id}
                  onClick={() => handleEditEvent(ev)}
                  className={cn(
                    "border px-4 py-3 rounded-xl shrink-0 min-w-[200px] relative overflow-hidden group/item transition-all",
                    colors.bg, colors.border,
                    isGuest ? "cursor-default" : "cursor-pointer hover:bg-white/5"
                  )}
                >
                  <div className={cn("absolute left-0 top-0 bottom-0 w-1", colors.solid)} />
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      {getEventIcon(ev.type, 10)}
                      <p className={cn("text-[8px] font-black uppercase tracking-widest", colors.text)}>{ev.type}</p>
                    </div>
                    {!isGuest && (
                      <button 
                        onClick={(e) => handleDeleteEvent(ev.id, e)}
                        className="text-slate-800 hover:text-rose-500 opacity-0 group-hover/item:opacity-100 mt-[-4px]"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                  <h5 className="text-[11px] font-bold text-white mb-2 truncate">{ev.title}</h5>
                  <div className="space-y-1">
                     <p className="text-[9px] text-slate-400 font-mono flex items-center gap-2 italic">
                       {formatDate(ev.startDate)} - {formatDate(ev.endDate)}
                     </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

    const dayWidth = 32; 
    const timelineDates: { date: Date, dateStr: string }[] = [];
    
    monthsToShow.forEach(m => {
       const days = daysInMonth(m.getFullYear(), m.getMonth());
       for(let i=1; i<=days; i++) {
         const d = new Date(m.getFullYear(), m.getMonth(), i);
         timelineDates.push({ date: d, dateStr: toLocalDateStr(d) });
       }
    });

    return (
      <div className="overflow-x-auto custom-scrollbar border rounded-xl" style={{ backgroundColor: 'var(--theme-container)', borderColor: 'var(--theme-border)' }}>
        <div style={{ width: timelineDates.length * dayWidth + 192 }}>
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
          <div className="divide-y divide-white/5 relative">
            {/* Vertical Separators Grid */}
            <div className="absolute inset-0 pointer-events-none flex" style={{ left: 192 }}>
              {timelineDates.map((_, i) => (
                <div key={i} style={{ width: dayWidth }} className="h-full border-r border-white/5 shrink-0" />
              ))}
            </div>

            {/* Hub Events Row */}
            <div className="flex group hover:bg-white/[0.01] relative z-20">
              <div className="w-48 shrink-0 border-r border-white/5 p-3 bg-emerald-900/10">
                <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2">
                  <Tag size={12} /> Hub Events
                </p>
                <p className="text-[8px] text-slate-600 font-mono uppercase mt-1">General Schedule</p>
              </div>
              <div className="flex-1 relative flex h-14 items-center">
                {events.map(ev => {
                  const colors = eventTypeColors[ev.type] || eventTypeColors.general;
                  const findIndex = (dateStr: string) => timelineDates.findIndex(td => td.dateStr === dateStr);
                  let startIdx = findIndex(ev.startDate);
                  let endIdx = findIndex(ev.endDate);
                  if (startIdx === -1 && endIdx === -1) return null;
                  if (startIdx === -1) startIdx = 0;
                  if (endIdx === -1) endIdx = timelineDates.length - 1;
                  const left = startIdx * dayWidth;
                  const width = (endIdx - startIdx + 1) * dayWidth;
                  return (
                    <div 
                      key={ev.id}
                      style={{ left, width }}
                      onClick={(e) => { e.stopPropagation(); handleEditEvent(ev); }}
                      className={cn(
                        "absolute h-8 rounded-lg flex items-center gap-2 px-3 border cursor-pointer hover:scale-[1.02] transition-all z-10 group/ev",
                        colors.border, colors.bg, colors.text
                      )}
                    >
                      {getEventIcon(ev.type, 10)}
                      <span className="text-[9px] font-black uppercase tracking-widest truncate">{ev.title}</span>
                      
                      {/* Enhanced Tooltip for Hub Events - SHOWN BELOW */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-slate-900 border border-white/10 p-3 rounded-xl shadow-2xl opacity-0 group-hover/ev:opacity-100 invisible group-hover/ev:visible transition-all z-50 pointer-events-none">
                         <div className={cn("w-full h-1 absolute top-0 left-0 rounded-t-xl", colors.solid)} />
                         <div className="flex items-center justify-between mb-1">
                           <p className="text-[10px] font-black text-white uppercase">{ev.title}</p>
                           <span className={cn("text-[8px] font-black uppercase tracking-tighter", colors.text)}>{ev.type}</span>
                         </div>
                         <p className="text-[9px] text-slate-400 leading-tight mb-2 italic">
                           {ev.description || 'Global hub-wide event'}
                         </p>
                         <div className="flex items-center gap-2 text-[9px] font-mono border-t border-white/5 pt-2">
                           <CalendarIcon size={10} className={colors.text} />
                           <span className="text-white">{formatDate(ev.startDate)}</span>
                           <span className="text-slate-500">-</span>
                           <span className="text-white">{formatDate(ev.endDate)}</span>
                         </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {sortedPersonnel.map(p => (
              <div key={p.id} className="flex group hover:bg-white/[0.01] relative z-10">
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

                    const showDates = width > 100;

                    return (
                      <div 
                        key={s.id}
                        style={{ left, width }}
                        className={cn(
                          "absolute h-7 rounded flex items-center justify-center px-1 group/bar border border-white/20 text-white transition-all hover:scale-[1.02] hover:z-20",
                          getGroupColor(p.rosterGroup),
                          getStatusColor(s.status)
                        )}
                        onClick={() => handleEdit(s)}
                      >
                        <div className="flex flex-col items-center leading-none">
                          <span className={cn("text-white font-black uppercase tracking-[0.1em] whitespace-nowrap", showDates ? "text-[8px]" : "text-[9px]")}>
                            {s.status === 'TRANSIT' ? 'TRANS' : s.status}
                          </span>
                          {showDates && (
                            <span className="text-[7px] opacity-90 font-mono font-black border-t border-white/20 mt-0.5 pt-0.5 whitespace-nowrap">
                              {s.startDate.split('-').slice(1).join('/')} - {s.endDate.split('-').slice(1).join('/')}
                            </span>
                          )}
                        </div>

                        {/* Enhanced Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 border border-white/10 p-3 rounded-xl shadow-2xl opacity-0 group-hover/bar:opacity-100 invisible group-hover/bar:visible transition-all z-50 pointer-events-none">
                          <div className={cn("w-full h-1 absolute top-0 left-0 rounded-t-xl", getGroupColor(p.rosterGroup))} />
                          <p className="text-[10px] font-black text-white mb-1 uppercase">{p.fullName}</p>
                          <div className="flex items-center gap-2 mb-2">
                             <span className={cn("text-[7px] px-1.5 py-0.5 rounded font-black text-white", getGroupColor(p.rosterGroup))}>{p.rosterGroup}</span>
                             <span className="text-[8px] font-bold text-slate-400">{s.status}</span>
                          </div>
                          <div className="space-y-1 text-[9px] font-mono">
                            <div className="flex justify-between">
                              <span className="text-slate-500 font-bold">START:</span>
                              <span className="text-white">{formatDate(s.startDate)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500 font-bold">END:</span>
                              <span className="text-white">{formatDate(s.endDate)}</span>
                            </div>
                          </div>
                        </div>
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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 md:gap-6 mb-8">
        <div className="flex flex-wrap gap-1.5 md:gap-2 order-2 lg:order-1">
          {(['month', 'week', 'personnel', 'gantt'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "px-2 md:px-5 py-1.5 md:py-2.5 rounded-lg md:rounded-xl flex items-center gap-1.5 md:gap-3 text-[7px] md:text-[10px] font-black uppercase tracking-widest transition-all border shadow-lg flex-1 md:flex-none justify-center",
                viewMode === mode 
                  ? "bg-blue-600 border-blue-400 text-white shadow-blue-500/25" 
                  : "bg-theme-container border-white/5 text-slate-500 hover:text-slate-300 hover:bg-white/5"
              )}
            >
              <div className="hidden sm:block">
                {mode === 'month' && <CalendarIcon size={12} />}
                {mode === 'week' && <Clock size={12} />}
                {mode === 'personnel' && <Users size={12} />}
                {mode === 'gantt' && <LayoutGrid size={12} />}
              </div>
              <span className="truncate">{mode}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 md:gap-4 order-1 lg:order-2 w-full lg:w-auto">
          <div className="flex items-center gap-2 md:gap-4 flex-1 lg:flex-none justify-between lg:justify-start bg-white/[0.02] border border-white/5 rounded-xl px-3 py-1.5 md:px-0 md:py-0 md:bg-transparent md:border-none">
            <h3 className="text-[10px] md:text-sm font-black text-[var(--theme-text)] uppercase tracking-widest text-center min-w-[80px] md:min-w-[150px]">
              {viewMode === 'week' 
                ? `WK ${currentDate.toLocaleDateString('default', { month: 'short', day: 'numeric' })}`
                : currentDate.toLocaleString('default', { month: 'short', year: 'numeric' })
              }
            </h3>
            <div className="flex gap-1 shrink-0">
              <button onClick={viewMode === 'week' ? handlePrevWeek : handlePrevMonth} className="p-1 md:p-2 border rounded-lg transition-all" style={{ backgroundColor: 'var(--theme-container)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}><ChevronLeft size={12} /></button>
              <button onClick={viewMode === 'week' ? handleNextWeek : handleNextMonth} className="p-1 md:p-2 border rounded-lg transition-all" style={{ backgroundColor: 'var(--theme-container)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}><ChevronRight size={12} /></button>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4 shrink-0 w-full xs:w-auto justify-end">
            {!isGuest && (
              <div className="flex gap-2 w-full xs:w-auto">
                <div className="relative group/add flex-1 xs:flex-none">
                  <button 
                    onClick={() => handleOpenAdd()}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-2.5 md:px-4 py-2 md:py-2.5 rounded-lg text-[7px] md:text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-900/40"
                  >
                    <Plus size={12} /> <span className="hidden sm:inline">Assign Duty Period</span><span className="sm:hidden">Duty</span>
                  </button>
                </div>

                <div className="relative group/event-btn flex-1 xs:flex-none">
                  <button 
                    onClick={() => handleOpenAddEvent()}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 md:px-4 py-2 md:py-2.5 rounded-lg text-[7px] md:text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-900/40"
                  >
                    <Tag size={10} /> <span className="hidden sm:inline">Add Hub Event</span><span className="sm:hidden">Event</span>
                  </button>
                </div>
              </div>
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

      {/* Event Modal */}
      <AnimatePresence>
        {isEventModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEventModalOpen(false)}
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
                  <Tag size={18} className="text-emerald-500" />
                  {editingEvent ? 'Edit Hub Event' : 'Create Hub Event'}
                </h3>
                <button onClick={() => setIsEventModalOpen(false)} className="p-2 text-slate-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmitEvent(onSaveEvent)} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Event Title</label>
                  <input {...registerEvent('title')} className="w-full bg-[#0a0a0c] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-emerald-500/30" placeholder="e.g. Rig Maintenance" />
                  {eventErrors.title && <p className="text-[10px] text-rose-500 px-1">{eventErrors.title.message}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Description</label>
                  <textarea {...registerEvent('description')} className="w-full bg-[#0a0a0c] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-emerald-500/30 min-h-[80px] resize-none" placeholder="Provide event details..." />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">
                      {watchRecurrence === 'none' ? 'Start Date' : 'Series Start Date'}
                    </label>
                    <input type="date" {...registerEvent('startDate')} className="w-full bg-[#0a0a0c] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-emerald-500/30" />
                    {eventErrors.startDate && <p className="text-[10px] text-rose-500 px-1">{eventErrors.startDate.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold px-1">
                      {watchRecurrence === 'none' ? 'End Date' : 'Series End Date'}
                    </label>
                    <input type="date" {...registerEvent('endDate')} className="w-full bg-[#0a0a0c] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-emerald-500/30" />
                    {eventErrors.endDate && <p className="text-[10px] text-rose-500 px-1">{eventErrors.endDate.message}</p>}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Location</label>
                  <select 
                    {...registerEvent('location')}
                    className="w-full bg-[#0a0a0c] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-emerald-500/30"
                  >
                    <option value="Algiers">Algiers</option>
                    <option value="Hassi Messaoud">Hassi Messaoud</option>
                    <option value="MLN">MLN</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Recurrence</label>
                  <select 
                    {...registerEvent('recurrence')}
                    disabled={!!editingEvent}
                    className="w-full bg-[#0a0a0c] border border-white/5 px-4 py-2.5 text-sm text-slate-300 rounded-lg focus:outline-none focus:border-emerald-500/30 disabled:opacity-50"
                  >
                    <option value="none">No Recurrence</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  {watchRecurrence !== 'none' && !editingEvent && (
                    <div className="pt-2">
                       <label className="text-[10px] text-slate-500 uppercase font-bold px-1 mb-2 block">Specific Days (Optional)</label>
                       <div className="flex flex-wrap gap-1">
                         {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                           <button
                             key={i}
                             type="button"
                             onClick={() => {
                               const current = watchRecurrenceDays || [];
                               if (current.includes(i)) {
                                 setEventValue('recurrenceDays', current.filter(d => d !== i));
                               } else {
                                 setEventValue('recurrenceDays', [...current, i]);
                               }
                             }}
                             className={cn(
                               "w-7 h-7 rounded flex items-center justify-center text-[10px] font-black border transition-all",
                               watchRecurrenceDays?.includes(i)
                                 ? "bg-emerald-500 text-white border-emerald-400"
                                 : "bg-black/40 border-white/5 text-slate-600 hover:border-white/20"
                             )}
                           >
                             {day}
                           </button>
                         ))}
                       </div>
                       <p className="text-[7px] text-slate-600 px-1 uppercase font-bold mt-2">Only generates on selected days</p>
                    </div>
                  )}
                  {!editingEvent && watchRecurrence !== 'none' && <p className="text-[7px] text-slate-600 px-1 uppercase font-bold mt-1">Generates events for 3 months</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold px-1">Event Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'general', label: 'General', icon: Info, colors: eventTypeColors.general },
                      { value: 'meeting', label: 'Meeting', icon: Clock, colors: eventTypeColors.meeting },
                      { value: 'holiday', label: 'Holiday', icon: Palmtree, colors: eventTypeColors.holiday },
                      { value: 'walkthrough', label: 'Walk Through', icon: Users, colors: eventTypeColors.walkthrough },
                    ].map(type => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setEventValue('type', type.value as any)}
                        className={cn(
                          "py-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest border flex items-center justify-center gap-2 transition-all",
                          watchEventType === type.value 
                            ? `${type.colors.bg.replace('/10', '/20')} ${type.colors.border} ${type.colors.text}`
                            : "bg-black/40 border-white/5 text-slate-600 hover:border-white/20"
                        )}
                      >
                        <type.icon size={12} />
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-6 border-t border-white/5 mt-6">
                  {editingEvent && (
                    <button 
                      type="button"
                      onClick={() => handleDeleteEvent(editingEvent.id)}
                      className="px-4 py-3 rounded-xl bg-rose-900/20 border border-rose-500/20 text-rose-500 text-xs font-bold uppercase tracking-widest hover:bg-rose-900/40 transition-all flex items-center justify-center"
                      title="Delete Event"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button 
                    type="button"
                    onClick={() => setIsEventModalOpen(false)}
                    className="px-4 py-3 rounded-xl bg-black border border-white/5 text-slate-400 text-xs font-bold uppercase tracking-widest hover:text-white transition-all flex-1"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-[2] px-4 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-900/40"
                  >
                    {editingEvent ? 'Update Event' : 'Save Event'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

                <div className="flex gap-2 pt-6 border-t border-white/5 mt-6">
                  {editingSchedule && (
                    <button 
                      type="button"
                      onClick={() => {
                        handleDelete(editingSchedule.id);
                        setIsModalOpen(false);
                        setEditingSchedule(null);
                      }}
                      className="px-4 py-3 rounded-xl bg-rose-900/20 border border-rose-500/20 text-rose-500 text-xs font-bold uppercase tracking-widest hover:bg-rose-900/40 transition-all flex items-center justify-center"
                      title="Delete Schedule"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-3 rounded-xl bg-black border border-white/5 text-slate-400 text-xs font-bold uppercase tracking-widest hover:text-white transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-[2] px-4 py-3 rounded-xl bg-blue-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/40"
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
