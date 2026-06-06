import React, { useState, useEffect, useMemo, MouseEvent, useRef } from 'react';
import { collection, onSnapshot, query, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Personnel, Scheduling, ScheduleStatus, HubEvent } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users, Clock, LayoutGrid, Plus, Trash2, X, AlertCircle, Wrench, Info, Palmtree, Tag, Search, SortAsc, Copy, FileDown, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from '../lib/utils';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';

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
  general: { bg: 'bg-blue-500/10', text: 'text-blue-800', border: 'border-blue-500/30', solid: 'bg-blue-600' },
  meeting: { bg: 'bg-amber-500/10', text: 'text-amber-800', border: 'border-amber-500/30', solid: 'bg-amber-600' },
  walkthrough: { bg: 'bg-purple-500/10', text: 'text-purple-800', border: 'border-purple-500/30', solid: 'bg-purple-600' },
  holiday: { bg: 'bg-emerald-500/10', text: 'text-emerald-800', border: 'border-emerald-500/30', solid: 'bg-emerald-600' },
};

type ViewMode = 'month' | 'week' | 'personnel' | 'gantt';

interface CrewCalendarProps {
  isGuest?: boolean;
}

export function CrewCalendar({ isGuest }: CrewCalendarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [ganttZoom, setGanttZoom] = useState<'days' | 'weeks' | 'quarter'>('days');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [dbSchedules, setDbSchedules] = useState<Scheduling[]>([]);
  const [dbEvents, setDbEvents] = useState<HubEvent[]>([]);
  const [simulatedSchedules, setSimulatedSchedules] = useState<Scheduling[]>([]);
  const [simulatedEvents, setSimulatedEvents] = useState<HubEvent[]>([]);

  const schedules = useMemo(() => {
    return [...dbSchedules, ...simulatedSchedules];
  }, [dbSchedules, simulatedSchedules]);

  const events = useMemo(() => {
    return [...dbEvents, ...simulatedEvents];
  }, [dbEvents, simulatedEvents]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Scheduling | null>(null);
  const [editingEvent, setEditingEvent] = useState<HubEvent | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'group'>('name');
  const [filterGroup, setFilterGroup] = useState<string>('ALL');
  const [filterPersonnel, setFilterPersonnel] = useState<string>('ALL');
  const [showGlobalEvents, setShowGlobalEvents] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [selectedDayDetails, setSelectedDayDetails] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportSettingsOpen, setIsExportSettingsOpen] = useState(false);
  const [exportStartYear, setExportStartYear] = useState(currentDate.getFullYear());
  const [exportStartMonth, setExportStartMonth] = useState(currentDate.getMonth());
  const [exportEndYear, setExportEndYear] = useState(currentDate.getFullYear());
  const [exportEndMonth, setExportEndMonth] = useState(currentDate.getMonth());
  const ganttRef = useRef<HTMLDivElement>(null);
  const [hoveredWeekItem, setHoveredWeekItem] = useState<{
    id: string;
    rect: { top: number, left: number, width: number };
    schedule: Scheduling;
    personnel?: Personnel;
  } | null>(null);

  const todayStr = toLocalDateStr(new Date());

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

  const getScheduleStyle = (s: Scheduling, group: string) => {
    const isSim = s.id?.startsWith('sim-');
    if (isSim) {
      if (group === 'A' || group === 'Group A') {
        return 'bg-blue-400/30 text-blue-950 border-2 border-dashed border-blue-500/70 shadow-none';
      }
      if (group === 'B' || group === 'Group B') {
        return 'bg-emerald-400/30 text-emerald-950 border-2 border-dashed border-emerald-500/70 shadow-none';
      }
      if (group === 'C' || group === 'Group C') {
        return 'bg-orange-400/35 text-orange-950 border-2 border-dashed border-orange-500/70 shadow-none';
      }
      if (group === 'D' || group === 'Group D') {
        return 'bg-purple-400/30 text-purple-950 border-2 border-dashed border-purple-500/70 shadow-none';
      }
      if (group === 'E' || group === 'Group E') {
        return 'bg-rose-400/30 text-rose-950 border-2 border-dashed border-rose-500/70 shadow-none';
      }
      return 'bg-slate-400/30 text-slate-950 border-2 border-dashed border-slate-500/70 shadow-none';
    }
    
    return `${getGroupColor(group)} text-white ${getStatusColor(s.status)} border-transparent`;
  };

  const sortedPersonnel = useMemo(() => {
    let list = [...personnel];
    
    // Virtual Personnel for Hub Events
    const hubVirtual: Personnel = {
      id: 'HUB_EVENTS',
      fullName: 'Hub Events',
      title: 'General Schedule',
      email: 'system@hub.local',
      rosterGroup: 'GLOBAL'
    };

    if (showGlobalEvents) {
      list.push(hubVirtual);
    }

    return list
      .filter(p => {
        if (p.id === 'HUB_EVENTS') {
          // Hub events only shown if personnel filter is ALL or if explicitly enabled
          if (filterPersonnel !== 'ALL') return false;
          if (filterGroup !== 'ALL' && filterGroup !== 'GLOBAL') return false;
          return true;
        }
        if (filterGroup !== 'ALL' && p.rosterGroup !== filterGroup) return false;
        if (filterPersonnel !== 'ALL' && p.id !== filterPersonnel) return false;
        return true;
      })
      .sort((a, b) => {
        // Always keep Hub at top or follow sorting?
        // Let's make Hub sort specifically if needed, but usually top is best or alpha.
        if (sortBy === 'name') {
          if (a.id === 'HUB_EVENTS') return -1;
          if (b.id === 'HUB_EVENTS') return 1;
          return a.fullName.localeCompare(b.fullName);
        }
        if (sortBy === 'group') {
          if (a.id === 'HUB_EVENTS') return -1;
          if (b.id === 'HUB_EVENTS') return 1;
          const groupCmp = a.rosterGroup.localeCompare(b.rosterGroup);
          if (groupCmp !== 0) return groupCmp;
          return a.fullName.localeCompare(b.fullName);
        }
        return 0;
      });
  }, [personnel, filterGroup, filterPersonnel, sortBy, showGlobalEvents]);

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
      setDbSchedules(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scheduling)));
    });
    const unsubE = onSnapshot(collection(db, 'events'), (snap) => {
      setDbEvents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HubEvent)));
    });
    return () => { unsubP(); unsubS(); unsubE(); };
  }, []);

  const onSaveEvent = async (data: EventFormData) => {
    try {
      if (isGuest) {
        if (editingEvent && editingEvent.id.startsWith('sim-')) {
          setSimulatedEvents(prev => prev.map(e => e.id === editingEvent.id ? {
            ...e,
            title: data.title,
            description: data.description || '',
            location: data.location,
            startDate: data.startDate,
            endDate: data.endDate,
            type: data.type
          } as HubEvent : e));
        } else {
          if (data.recurrence === 'none') {
            const newSim = {
              id: `sim-ev-${Date.now()}`,
              ...data,
              createdAt: new Date()
            } as any;
            setSimulatedEvents(prev => [...prev, newSim]);
          } else {
            const eventsToCreate: HubEvent[] = [];
            const seriesStart = new Date(data.startDate);
            const seriesEnd = new Date(data.endDate);
            let current = new Date(seriesStart);
            const originalDay = seriesStart.getDate();

            while (current <= seriesEnd) {
              const dayOfWeek = current.getDay();
              const isAllowedDay = !data.recurrenceDays || data.recurrenceDays.length === 0 || data.recurrenceDays.includes(dayOfWeek);

              if (isAllowedDay) {
                eventsToCreate.push({
                  id: `sim-ev-${Date.now()}-${current.getTime()}`,
                  ...data,
                  startDate: toLocalDateStr(current),
                  endDate: toLocalDateStr(current),
                  createdAt: new Date()
                } as any);
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
            setSimulatedEvents(prev => [...prev, ...eventsToCreate]);
          }
        }
        setIsEventModalOpen(false);
        setEditingEvent(null);
        resetEvent({ type: 'general', title: '', description: '', startDate: '', endDate: '', recurrence: 'none', recurrenceDays: [] });
        return;
      }

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

  const handleOpenAddEvent = (dateStr?: string, overrideGuestCheck = false) => {
    if (isGuest && !overrideGuestCheck) return;
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
    if (isGuest && !ev.id.startsWith('sim-')) return;
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
    if (id.startsWith('sim-')) {
      if (confirm('Are you sure you want to delete this simulated event?')) {
        setSimulatedEvents(prev => prev.filter(ev => ev.id !== id));
        setIsEventModalOpen(false);
        setEditingEvent(null);
      }
      return;
    }
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
      if (isGuest) {
        if (editingSchedule && editingSchedule.id.startsWith('sim-')) {
          setSimulatedSchedules(prev => prev.map(s => s.id === editingSchedule.id ? {
            ...s,
            personnelId: data.personnelIds[0],
            startDate: data.startDate,
            endDate: data.endDate,
            status: data.status
          } as Scheduling : s));
        } else {
          // Simulated Multi-save or single-save
          const newSims = data.personnelIds.map(pid => ({
            id: `sim-${Date.now()}-${pid}`,
            personnelId: pid,
            startDate: data.startDate,
            endDate: data.endDate,
            status: data.status,
            createdAt: new Date()
          } as any));
          setSimulatedSchedules(prev => [...prev, ...newSims]);
        }
        setIsModalOpen(false);
        setEditingSchedule(null);
        reset({ status: 'ON_DUTY', personnelIds: [] });
        return;
      }

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

  const handleOpenAdd = (dateStr?: string, pId?: string, overrideGuestCheck = false) => {
    if (isGuest && !overrideGuestCheck) return;
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
    if (isGuest && !s.id.startsWith('sim-')) return;
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
    if (!id) return;
    const idStr = String(id);
    if (idStr.startsWith('sim-')) {
      if (confirm('Delete this simulated duty record?')) {
        setSimulatedSchedules(prev => prev.filter(s => s.id !== idStr));
        setIsModalOpen(false);
        setEditingSchedule(null);
      }
      return;
    }
    if (isGuest) return;
    if (confirm('Delete this duty record?')) {
      try {
        await deleteDoc(doc(db, 'schedules', idStr));
        setIsModalOpen(false);
        setEditingSchedule(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'schedules');
      }
    }
  };

  const handleCopyToClipboard = () => {
    const summary = sortedPersonnel.map(p => {
      const pSchedules = schedules.filter(s => s.personnelId === p.id);
      return `${p.fullName} (${p.rosterGroup}): ${pSchedules.length} duty periods assigned.`;
    }).join('\n');
    
    navigator.clipboard.writeText(summary);
    alert('Crew schedule summary copied to clipboard!');
  };

  const handleExportPDF = () => {
    setExportStartYear(currentDate.getFullYear());
    setExportStartMonth(currentDate.getMonth());
    setExportEndYear(currentDate.getFullYear());
    setExportEndMonth(currentDate.getMonth());
    setIsExportSettingsOpen(true);
  };

  const confirmExport = async () => {
    if (!ganttRef.current) return;
    setIsExportSettingsOpen(false);
    setIsExporting(true);

    const originalDate = currentDate;
    const originalViewMode = viewMode;

    const getMonthsInRange = (startY: number, startM: number, endY: number, endM: number) => {
      const list: Date[] = [];
      let y = startY;
      let m = startM;
      while (y < endY || (y === endY && m <= endM)) {
        list.push(new Date(y, m, 1));
        m++;
        if (m > 11) {
          m = 0;
          y++;
        }
      }
      return list;
    };

    let startY = exportStartYear;
    let startM = exportStartMonth;
    let endY = exportEndYear;
    let endM = exportEndMonth;

    if (startY > endY || (startY === endY && startM > endM)) {
      [startY, endY] = [endY, startY];
      [startM, endM] = [endM, startM];
    }

    const months = getMonthsInRange(startY, startM, endY, endM);
    setViewMode('gantt');

    try {
      let pdf: jsPDF | null = null;

      for (let i = 0; i < months.length; i++) {
        const monthDate = months[i];
        setCurrentDate(monthDate);
        
        // Wait for React to re-render the Gantt view with new date
        await new Promise((resolve) => setTimeout(resolve, 800));

        const dataUrl = await toPng(ganttRef.current!, { 
          backgroundColor: '#0a0a0c',
          quality: 1,
          pixelRatio: 2
        });

        const width = ganttRef.current!.scrollWidth;
        const height = ganttRef.current!.scrollHeight;

        if (!pdf) {
          pdf = new jsPDF('l', 'px', [width, height]);
        } else {
          pdf.addPage([width, height], 'l');
        }

        pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
      }

      if (pdf) {
        const startMonthStr = String(startM + 1).padStart(2, '0');
        const endMonthStr = String(endM + 1).padStart(2, '0');
        pdf.save(`Crew_Roster_${startY}_${startMonthStr}_to_${endY}_${endMonthStr}.pdf`);
      }
    } catch (err) {
      console.error('Export failed', err);
      alert('An error occurred during PDF generation.');
    } finally {
      // Restore the application state
      setCurrentDate(originalDate);
      setViewMode(originalViewMode);
      setIsExporting(false);
    }
  };

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const handlePrevMonth = () => {
    if (viewMode === 'gantt' && ganttZoom === 'quarter') {
      setCurrentDate(new Date(currentDate.getFullYear() - 1, currentDate.getMonth(), 1));
    } else {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    }
  };

  const handleNextMonth = () => {
    if (viewMode === 'gantt' && ganttZoom === 'quarter') {
      setCurrentDate(new Date(currentDate.getFullYear() + 1, currentDate.getMonth(), 1));
    } else {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    }
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
      days.push(<div key={`empty-${i}`} className="h-24 bg-slate-50 border border-slate-100"></div>);
    }

    for (let day = 1; day <= totalDays; day++) {
      const dateStr = toLocalDateStr(new Date(year, month, day));
      const activeSchedules = filteredSchedules.filter(s => {
        const start = s.startDate;
        const end = s.endDate;
        return dateStr >= start && dateStr <= end;
      });
      const activeEvents = events.filter(e => dateStr >= e.startDate && dateStr <= e.endDate);

      const isToday = dateStr === todayStr;

      days.push(
        <div 
          key={day} 
          onMouseEnter={() => setHoveredDay(dateStr)}
          onMouseLeave={() => setHoveredDay(null)}
          onClick={() => setSelectedDayDetails(dateStr)}
          className={cn(
            "h-28 border p-2 flex flex-col hover:bg-slate-50 transition-colors group relative cursor-pointer",
            isToday ? "bg-emerald-50 border-emerald-500/50" : "bg-white border-slate-200"
          )}
        >
          {isToday && (
            <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 animate-pulse z-10" />
          )}
 
          {/* Detailed Tooltip Overlay - Now "popping out" with better shadow */}
          <AnimatePresence>
            {hoveredDay === dateStr && activeSchedules.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-[60] w-64 bg-white p-3 shadow-2xl border border-slate-200 rounded-xl backdrop-blur-md flex flex-col pointer-events-none"
              >
                <div className="flex items-center justify-between mb-2 border-b border-slate-100 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-black text-black uppercase tracking-widest">Active Crew ({activeSchedules.length})</span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-500">{day} {currentDate.toLocaleString('default', { month: 'short' })}</span>
                </div>
                <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5">
                  {activeSchedules.map(s => {
                    const p = personnel.find(pers => pers.id === s.personnelId);
                    if (!p) return null;
                    const isSim = s.id.startsWith('sim-');
                    return (
                      <div key={s.id} className="flex items-start justify-between gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold text-black truncate uppercase leading-tight flex items-center gap-1">
                            <span>{p.fullName}</span>
                            {isSim && (
                              <span className="text-[6px] text-indigo-600 font-black uppercase bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded leading-none shrink-0">
                                Sim
                              </span>
                            )}
                          </p>
                          <p className="text-[8px] text-slate-500 uppercase truncate leading-tight italic">{p.rosterGroup} • {p.title}</p>
                        </div>
                        <span className={cn(
                          "text-[7px] px-1.5 py-0.5 rounded-sm font-black uppercase text-white h-fit",
                          s.status === 'TRANSIT' ? "bg-blue-600" : "bg-emerald-600"
                        )}>
                          {s.status === 'TRANSIT' ? 'In Trns' : 'On Dty'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-center">
                  <p className="text-[7px] text-emerald-600 font-black uppercase tracking-tighter">Click to see full details</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
 
          <div className="flex items-center justify-between mb-1 relative z-10">
             <span className={cn("text-[10px] font-mono", isToday ? "text-emerald-600 font-black" : "text-black")}>{day}</span>
             {isGuest ? (
               <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                 <button onClick={(e) => { e.stopPropagation(); handleOpenAdd(dateStr, undefined, true); }} className="p-0.5 hover:text-indigo-600 text-indigo-400 transition-colors" title="Simulate Duty"><Plus size={10} /></button>
                 <button onClick={(e) => { e.stopPropagation(); handleOpenAddEvent(dateStr, true); }} className="p-0.5 hover:text-purple-600 text-purple-400 transition-colors" title="Simulate Event"><Tag size={8} /></button>
               </div>
             ) : (
               <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                 <button onClick={(e) => { e.stopPropagation(); handleOpenAdd(dateStr); }} className="p-0.5 hover:text-blue-600 text-slate-400 transition-colors" title="Add Duty"><Plus size={10} /></button>
                 <button onClick={(e) => { e.stopPropagation(); handleOpenAddEvent(dateStr); }} className="p-0.5 hover:text-emerald-600 text-slate-400 transition-colors" title="Add Event"><Tag size={8} /></button>
               </div>
             )}
          </div>
          <div className="flex-1 space-y-1 overflow-hidden">
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
              const isSim = s.id.startsWith('sim-');
              return (
                <div 
                  key={s.id} 
                  onClick={(e) => { e.stopPropagation(); handleEdit(s); }}
                  className={cn(
                    "text-[8px] px-1.5 py-1 rounded-md truncate font-black uppercase tracking-tighter flex items-center gap-1.5 border transition-colors",
                    getScheduleStyle(s, person?.rosterGroup || ''),
                    (isGuest && !isSim) ? "cursor-default" : "cursor-pointer hover:scale-[1.02]"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", isSim ? "bg-indigo-600 animate-pulse" : "bg-white/40")} />
                  <span>{person?.fullName || 'Crew'}{isSim ? ' (Simulation)' : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto md:overflow-x-visible custom-scrollbar">
        <div className="grid grid-cols-7 border-t border-l border-slate-200 min-w-[320px] md:min-w-0">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => (
            <div key={`${d}-${idx}`} className="bg-slate-50 border-b border-r border-slate-200 py-2 text-center text-[8px] md:text-[9px] font-black text-black tracking-widest">{d}</div>
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
      const isToday = dateStr === todayStr;
      return { date: d, dateStr, isToday };
    });

    return (
      <div className="overflow-x-auto md:overflow-x-visible custom-scrollbar relative">
        {/* Fixed Position Tooltip for Week View */}
        <AnimatePresence>
          {hoveredWeekItem && (
            <motion.div
              initial={{ opacity: 0, y: 5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 5, scale: 0.95 }}
              className="fixed z-[9999] w-64 bg-white border border-slate-200 p-3 rounded-xl shadow-2xl pointer-events-none"
              style={{
                top: hoveredWeekItem.rect.top - 10,
                left: hoveredWeekItem.rect.left + hoveredWeekItem.rect.width / 2,
                transform: 'translate(-50%, -100%)'
              }}
            >
              <div className={cn("w-full h-1 absolute top-0 left-0 rounded-t-xl", getGroupColor(hoveredWeekItem.personnel?.rosterGroup || ''))} />
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-black text-black uppercase flex items-center gap-1">
                  <span>{hoveredWeekItem.personnel?.fullName || 'Crew Member'}</span>
                  {hoveredWeekItem.schedule.id.startsWith('sim-') && (
                    <span className="text-[6px] text-indigo-600 font-extrabold uppercase bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded leading-none shrink-0">
                      Simulation
                    </span>
                  )}
                </p>
                <span className={cn(
                  "text-[8px] px-1.5 py-0.5 rounded font-black text-white",
                  hoveredWeekItem.schedule.id.startsWith('sim-') 
                    ? "bg-indigo-600/90 shadow-md shadow-indigo-500/20" 
                    : (hoveredWeekItem.schedule.status === 'TRANSIT' ? "bg-blue-600" : "bg-emerald-600")
                )}>
                  {hoveredWeekItem.schedule.id.startsWith('sim-') ? 'SIMULATED' : hoveredWeekItem.schedule.status}
                </span>
              </div>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight mb-2 italic">
                {hoveredWeekItem.personnel?.title || 'No title set'} • {hoveredWeekItem.personnel?.rosterGroup}
              </p>
              <div className="space-y-1 text-[8px] font-mono border-t border-slate-100 pt-2">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-bold">START:</span>
                  <span className="text-black">{formatDate(hoveredWeekItem.schedule.startDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-bold">END:</span>
                  <span className="text-black">{formatDate(hoveredWeekItem.schedule.endDate)}</span>
                </div>
              </div>
              {(!isGuest || hoveredWeekItem.schedule.id.startsWith('sim-')) && (
                <p className="text-[7px] text-indigo-500 mt-2 font-black uppercase text-center border-t border-white/5 pt-1.5 border-dashed">Click to edit details</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-7 border-t border-l border-slate-200 h-[450px] md:h-[600px] min-w-[320px] md:min-w-0">
        {weekDays.map(({ date, dateStr, isToday }) => (
          <div 
            key={dateStr} 
            className={cn(
              "bg-white border-b border-r border-slate-200 flex flex-col hover:bg-slate-50 transition-colors group relative",
              isToday ? "bg-emerald-50" : "",
              isGuest ? "cursor-default" : "cursor-default"
            )}
          >
            {isToday && <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 animate-pulse z-20" />}
            <div className={cn("bg-slate-50 py-2 text-center border-b border-slate-200 relative", isToday ? "bg-emerald-100" : "")}>
              <p className={cn("text-[10px] font-bold uppercase", isToday ? "text-emerald-700" : "text-slate-600")}>{date.toLocaleDateString('default', { weekday: 'short' })}</p>
              <p className={cn("text-[14px] font-mono", isToday ? "text-emerald-700 font-black" : "text-black")}>{date.getDate()}</p>
              {isGuest ? (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleOpenAdd(dateStr, undefined, true)} className="p-1 hover:text-indigo-600 text-indigo-400" title="Simulate Duty"><Plus size={12} /></button>
                  <button onClick={() => handleOpenAddEvent(dateStr, true)} className="p-1 hover:text-purple-600 text-purple-400" title="Simulate Event"><Tag size={10} /></button>
                </div>
              ) : (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleOpenAdd(dateStr)} className="p-1 hover:text-blue-600 text-slate-400" title="Add Duty"><Plus size={12} /></button>
                  <button onClick={() => handleOpenAddEvent(dateStr)} className="p-1 hover:text-emerald-600 text-slate-400" title="Add Event"><Tag size={10} /></button>
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
                    <div className="absolute bottom-full left-0 mb-2 w-40 bg-white p-2 rounded-xl border border-slate-200 text-[8px] invisible group-hover/event:visible z-50 shadow-2xl">
                      <div className={cn("w-full h-0.5 absolute top-0 left-0 rounded-t-xl", colors.solid)} />
                      <p className="font-bold border-b border-slate-100 pb-1 mb-1 text-black">{ev.title}</p>
                      <p className="text-slate-500 leading-tight">{ev.description || 'No description provided'}</p>
                      <p className="text-[7px] text-slate-400 mt-2 font-mono uppercase">{formatDate(ev.startDate)} - {formatDate(ev.endDate)}</p>
                    </div>
                    {(!isGuest || ev.id.startsWith('sim-')) && (
                      <button onClick={(e) => handleDeleteEvent(ev.id, e)} className={cn("opacity-0 group-hover/event:opacity-100 transition-opacity", ev.id.startsWith('sim-') ? "text-indigo-600 hover:text-rose-600" : "hover:text-rose-500 text-slate-700")}>
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                );
              })}
              {filteredSchedules.filter(s => dateStr >= s.startDate && dateStr <= s.endDate).map(s => {
                const person = personnel.find(p => p.id === s.personnelId);
                const isSim = s.id.startsWith('sim-');
                return (
                  <div 
                    key={s.id} 
                    onClick={(e) => { e.stopPropagation(); handleEdit(s); }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredWeekItem({
                        id: s.id,
                        rect: { top: rect.top, left: rect.left, width: rect.width },
                        schedule: s,
                        personnel: person
                      });
                    }}
                    onMouseLeave={() => setHoveredWeekItem(null)}
                    className={cn(
                      "p-2 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all relative group",
                      getScheduleStyle(s, person?.rosterGroup || ''),
                      (isGuest && !isSim) ? "cursor-default" : "cursor-pointer hover:scale-[1.02]"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="truncate">{person?.fullName || 'Crew'}{isSim ? ' (Simulation)' : ''}</span>
                      <span className={cn("text-[7px] px-1 rounded-sm", isSim ? "bg-indigo-600/25 text-indigo-900 border border-indigo-500/30 font-extrabold" : "bg-white/20 text-white")}>
                        {isSim ? 'SIM' : s.status}
                      </span>
                    </div>
                    <p className="text-[7px] opacity-75 font-mono italic">{formatDate(s.startDate)} - {formatDate(s.endDate)}</p>
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
                    {(!isGuest || ev.id.startsWith('sim-')) && (
                      <button 
                        onClick={(e) => handleDeleteEvent(ev.id, e)}
                        className={cn("opacity-0 group-hover/item:opacity-100 mt-[-4px]", ev.id.startsWith('sim-') ? "text-indigo-400 hover:text-rose-400" : "text-slate-800 hover:text-rose-500")}
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
                {isGuest ? (
                  <button 
                    onClick={() => handleOpenAdd(undefined, p.id, true)}
                    className="p-1 text-indigo-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100"
                    title="Simulate Duty Assignment"
                  >
                    <Plus size={14} />
                  </button>
                ) : (
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
                pSchedules.map(s => {
                  const isSim = s.id.startsWith('sim-');
                  return (
                    <div 
                      key={s.id} 
                      onClick={() => handleEdit(s)}
                      className={cn(
                        "border px-4 py-3 rounded-xl shrink-0 min-w-[160px] relative overflow-hidden group/item transition-all shadow-sm",
                        isSim 
                          ? `${getScheduleStyle(s, p.rosterGroup)} relative overflow-hidden bg-white/5` 
                          : "bg-slate-50 border-slate-200 text-slate-800",
                        (isGuest && !isSim) ? "cursor-default" : "cursor-pointer hover:border-blue-200 hover:bg-white"
                      )}
                    >
                      {!isSim && (
                        <div className={cn(
                          "absolute left-0 top-0 bottom-0 w-1",
                          s.status === 'ON_DUTY' ? "bg-emerald-500" : s.status === 'TRANSIT' ? "bg-blue-500" : "bg-slate-700"
                        )} />
                      )}
                      <div className="flex justify-between items-start mb-2">
                        <p className={cn("text-[8px] font-black uppercase tracking-[0.2em]", isSim ? "text-indigo-900" : "text-slate-500")}>
                          {s.status} {isSim && <span className="text-indigo-600 font-extrabold">(SIM)</span>}
                        </p>
                        {(!isGuest || isSim) && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                            className={cn("opacity-0 group-hover/item:opacity-100 mt-[-4px]", isSim ? "text-indigo-600 hover:text-rose-600" : "text-slate-300 hover:text-rose-500")}
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                         <p className="text-[11px] font-mono font-black flex items-center gap-2">
                           <span className={cn("text-[9px] font-bold", isSim ? "text-slate-700 font-bold" : "text-slate-400")}>START:</span> {formatDate(s.startDate)}
                         </p>
                         <p className="text-[11px] font-mono font-black flex items-center gap-2 border-t border-slate-100 pt-1 mt-1">
                           <span className={cn("text-[9px] font-bold", isSim ? "text-slate-700 font-bold" : "text-slate-400")}>END:</span> {formatDate(s.endDate)}
                         </p>
                      </div>
                    </div>
                  );
                })
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
    
    // Only show the target month during export to keep the PDF focused
    const monthsToShow = isExporting ? [new Date(year, month, 1)] : [
      new Date(year, month - 1, 1),
      new Date(year, month, 1),
      new Date(year, month + 1, 1)
    ];

    let colWidth = 32;
    let gridStartMs = 0;
    let gridEndMs = 0;
    let durationMs = 0;
    let totalColumns = 0;

    let colDatesHeaderHtml: React.ReactNode = null;
    let colPeriodHeaderHtml: React.ReactNode = null;
    let todayLineHtml: React.ReactNode = null;
    let gridLinesHtml: React.ReactNode = null;

    // To parse local YYYY-MM-DD date strings uniformly across browsers (prevents Safari/Firefox issues)
    const parseLocalDate = (dateStr: string, timeSuffix: 'start' | 'end') => {
      const [y, m, d] = dateStr.split('-').map(Number);
      if (timeSuffix === 'start') {
        return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
      } else {
        return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
      }
    };

    if (ganttZoom === 'days') {
      colWidth = 32;
      const timelineDates: { date: Date, dateStr: string, isToday: boolean }[] = [];
      
      monthsToShow.forEach(m => {
         const days = daysInMonth(m.getFullYear(), m.getMonth());
         for(let i=1; i<=days; i++) {
           const d = new Date(m.getFullYear(), m.getMonth(), i);
           const dateStr = toLocalDateStr(d);
           timelineDates.push({ date: d, dateStr, isToday: dateStr === todayStr });
         }
      });

      totalColumns = timelineDates.length;
      gridStartMs = parseLocalDate(toLocalDateStr(timelineDates[0].date), 'start');
      gridEndMs = parseLocalDate(toLocalDateStr(timelineDates[timelineDates.length - 1].date), 'end');
      durationMs = gridEndMs - gridStartMs;

      colDatesHeaderHtml = (
        <div className="flex-1 flex overflow-hidden">
          {monthsToShow.map(m => {
            const days = daysInMonth(m.getFullYear(), m.getMonth());
            return (
              <div key={m.getTime()} style={{ width: days * colWidth }} className="shrink-0 text-center text-[9px] font-black text-black py-3 bg-slate-50/50 border-r border-slate-200 uppercase">
                {m.toLocaleString('default', { month: 'long', year: 'numeric' })}
              </div>
            );
          })}
        </div>
      );

      colPeriodHeaderHtml = (
        <div className="flex-1 flex">
          {timelineDates.map(({ date, isToday }, i) => (
            <div key={i} style={{ width: colWidth }} className={cn(
              "shrink-0 text-center text-[8px] font-bold py-1.5 border-r border-slate-200 relative",
              isToday ? "bg-emerald-500/20 text-emerald-600" : (date.getDay() === 0 || date.getDay() === 6 ? "bg-slate-50 text-slate-400" : "text-black")
            )}>
              {date.getDate()}
              {isToday && (
                <div className="absolute top-0 left-0 w-full h-0.5 bg-emerald-500 animate-pulse" />
              )}
            </div>
          ))}
        </div>
      );

      gridLinesHtml = (
        <div className="absolute inset-0 pointer-events-none flex" style={{ left: 192 }}>
          {timelineDates.map((_, i) => (
            <div key={i} style={{ width: colWidth }} className="h-full border-r border-slate-200 shrink-0 opacity-45" />
          ))}
        </div>
      );
    } else if (ganttZoom === 'weeks') {
      colWidth = 110;
      
      const getMonday = (d: Date) => {
        const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.setDate(diff));
      };

      const firstMonthDate = monthsToShow[0];
      const lastMonthDate = monthsToShow[monthsToShow.length - 1];
      const lastDayOfLastMonth = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0);

      const gridStart = getMonday(firstMonthDate);
      const gridEnd = getMonday(lastDayOfLastMonth);
      gridEnd.setDate(gridEnd.getDate() + 6); // End of week on Sunday

      gridStartMs = gridStart.getTime();
      gridEndMs = gridEnd.getTime() + 24 * 60 * 60 * 1000 - 1;
      durationMs = gridEndMs - gridStartMs;

      const timelineWeeks: { startDate: Date; endDate: Date; label: string; dateRangeStr: string; weekNum: number; isCurrent: boolean }[] = [];
      const todayTime = new Date().getTime();

      let curr = new Date(gridStart);
      while (curr <= gridEnd) {
        const wStart = new Date(curr);
        const wEnd = new Date(curr);
        wEnd.setDate(wEnd.getDate() + 6);

        // Standard ISO week number
        const tempDate = new Date(wStart.valueOf());
        tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
        const yearStart = new Date(tempDate.getFullYear(), 0, 1);
        const weekNum = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

        const isCurrent = todayTime >= wStart.getTime() && todayTime <= (wEnd.getTime() + 24 * 60 * 60 * 1000);

        timelineWeeks.push({
          startDate: wStart,
          endDate: wEnd,
          label: `Wk ${weekNum}`,
          dateRangeStr: `${wStart.toLocaleString('default', { month: 'short' })} ${wStart.getDate()} - ${wEnd.toLocaleString('default', { month: 'short' })} ${wEnd.getDate()}`,
          weekNum,
          isCurrent
        });

        curr.setDate(curr.getDate() + 7);
      }

      totalColumns = timelineWeeks.length;

      // Group weeks into month header segments
      const weeksByMonth: { key: string; monthLabel: string; count: number }[] = [];
      timelineWeeks.forEach(w => {
        const m = w.startDate;
        const label = m.toLocaleString('default', { month: 'long', year: 'numeric' });
        const key = `${m.getFullYear()}-${m.getMonth()}`;
        if (weeksByMonth.length === 0 || weeksByMonth[weeksByMonth.length - 1].key !== key) {
          weeksByMonth.push({ key, monthLabel: label, count: 1 });
        } else {
          weeksByMonth[weeksByMonth.length - 1].count++;
        }
      });

      colDatesHeaderHtml = (
        <div className="flex-1 flex overflow-hidden">
          {weeksByMonth.map(segment => (
            <div key={segment.key} style={{ width: segment.count * colWidth }} className="shrink-0 text-center text-[9px] font-black text-black py-3 bg-slate-50/50 border-r border-slate-200 uppercase">
              {segment.monthLabel}
            </div>
          ))}
        </div>
      );

      colPeriodHeaderHtml = (
        <div className="flex-1 flex">
          {timelineWeeks.map((w, i) => (
            <div key={i} style={{ width: colWidth }} className={cn(
              "shrink-0 text-center py-1 border-r border-slate-200 relative flex flex-col justify-center items-center leading-normal",
              w.isCurrent ? "bg-emerald-500/10 text-emerald-700" : "text-black bg-white"
            )}>
              <span className="text-[9px] font-black tracking-widest uppercase">{w.label}</span>
              <span className="text-[7px] text-slate-500 font-mono tracking-tighter whitespace-nowrap">{w.dateRangeStr}</span>
              {w.isCurrent && (
                <div className="absolute top-0 left-0 w-full h-0.5 bg-emerald-500 animate-pulse" />
              )}
            </div>
          ))}
        </div>
      );

      gridLinesHtml = (
        <div className="absolute inset-0 pointer-events-none flex" style={{ left: 192 }}>
          {timelineWeeks.map((_, i) => (
            <div key={i} style={{ width: colWidth }} className="h-full border-r border-slate-200 shrink-0 opacity-45" />
          ))}
        </div>
      );
    } else {
      colWidth = 110;
      const yearVal = currentDate.getFullYear();
      
      const startD = new Date(yearVal, 0, 1, 0, 0, 0, 0);
      const endD = new Date(yearVal, 11, 31, 23, 59, 59, 999);
      
      gridStartMs = startD.getTime();
      gridEndMs = endD.getTime();
      durationMs = gridEndMs - gridStartMs;

      const timelineMonths: { startDate: Date; endDate: Date; label: string; monthIdx: number; isCurrent: boolean }[] = [];
      const todayObj = new Date();
      const currentMonthVal = todayObj.getMonth();
      const currentYearVal = todayObj.getFullYear();

      for (let m = 0; m < 12; m++) {
        const sm = new Date(yearVal, m, 1);
        const em = new Date(yearVal, m + 1, 0);
        const isCurrent = yearVal === currentYearVal && m === currentMonthVal;
        
        timelineMonths.push({
          startDate: sm,
          endDate: em,
          label: sm.toLocaleString('default', { month: 'short' }),
          monthIdx: m,
          isCurrent
        });
      }

      totalColumns = 12;

      const quarters = [
        { label: `Q1 ${yearVal}`, count: 3 },
        { label: `Q2 ${yearVal}`, count: 3 },
        { label: `Q3 ${yearVal}`, count: 3 },
        { label: `Q4 ${yearVal}`, count: 3 }
      ];

      colDatesHeaderHtml = (
        <div className="flex-1 flex overflow-hidden">
          {quarters.map((q, idx) => (
            <div key={idx} style={{ width: q.count * colWidth }} className="shrink-0 text-center text-[9px] font-black text-black py-3 bg-slate-50/50 border-r border-slate-200 uppercase">
              {q.label}
            </div>
          ))}
        </div>
      );

      colPeriodHeaderHtml = (
        <div className="flex-1 flex">
          {timelineMonths.map((m, i) => (
            <div key={i} style={{ width: colWidth }} className={cn(
              "shrink-0 text-center py-2 border-r border-slate-200 relative flex flex-col justify-center items-center font-black uppercase text-[8px]",
              m.isCurrent ? "bg-emerald-500/15 text-emerald-700" : "text-black bg-white"
            )}>
              {m.label}
              {m.isCurrent && (
                <div className="absolute top-0 left-0 w-full h-0.5 bg-emerald-500 animate-pulse" />
              )}
            </div>
          ))}
        </div>
      );

      gridLinesHtml = (
        <div className="absolute inset-0 pointer-events-none flex" style={{ left: 192 }}>
          {timelineMonths.map((_, i) => (
            <div key={i} style={{ width: colWidth }} className="h-full border-r border-slate-200 shrink-0 opacity-45" />
          ))}
        </div>
      );
    }

    const totalGridWidth = totalColumns * colWidth;

    todayLineHtml = (() => {
      const nowMs = Date.now();
      if (nowMs < gridStartMs || nowMs > gridEndMs) return null;
      const todayPercent = (nowMs - gridStartMs) / durationMs;
      const leftPx = 192 + todayPercent * totalGridWidth;
      return (
        <div 
          className="absolute top-0 bottom-0 z-20 w-px bg-emerald-500/40 pointer-events-none"
          style={{ left: leftPx }}
        >
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full -ml-[3px] mt-[42px] animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
        </div>
      );
    })();

    return (
      <div className="flex flex-col gap-4">
        {/* Gantt View Scale Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--theme-card)] border border-[var(--theme-border)] p-3 rounded-2xl">
          <div className="flex items-center gap-2">
            <LayoutGrid size={14} className="text-indigo-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] font-black">Gantt Scale</span>
          </div>
          <div className="flex bg-[var(--theme-container)] p-1 rounded-xl gap-1 border border-[var(--theme-border)]">
            {(['days', 'weeks', 'quarter'] as const).map(zoomVal => (
              <button
                key={zoomVal}
                onClick={() => setGanttZoom(zoomVal)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                  ganttZoom === zoomVal 
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10" 
                    : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
                )}
              >
                {zoomVal}
              </button>
            ))}
          </div>
        </div>

        {/* Chart Body */}
        <div className="overflow-x-auto custom-scrollbar border rounded-xl relative" ref={ganttRef} style={{ backgroundColor: 'var(--theme-container)', borderColor: 'var(--theme-border)', maxHeight: isExporting ? 'none' : '700px', overflowY: isExporting ? 'visible' : 'auto' }}>
          <div style={{ width: totalGridWidth + 192 }}>
            {/* Header */}
            <div className="flex border-b border-slate-200 bg-white sticky top-0 z-40">
              <div className="w-48 shrink-0 border-r border-slate-200 p-3 text-[10px] font-black text-black bg-slate-50 uppercase tracking-widest sticky left-0 z-50">Crew Roster</div>
              {colDatesHeaderHtml}
            </div>
            <div className="flex border-b border-slate-200 bg-white sticky top-[42px] z-40">
              <div className="w-48 shrink-0 border-r border-slate-200 sticky left-0 z-50 bg-white"></div>
              {colPeriodHeaderHtml}
            </div>

            {/* Today Indicator Line (Full Height) */}
            {todayLineHtml}

            {/* Rows */}
            <div className="divide-y divide-slate-200 relative">
              {/* Vertical Separators Grid */}
              {gridLinesHtml}

              {/* Integrated Rows */}
              {sortedPersonnel.map(p => {
                if (p.id === 'HUB_EVENTS') {
                  return (
                    <div key="HUB_EVENTS" className="flex group hover:bg-slate-50 relative z-20">
                      <div className="w-48 shrink-0 border-r border-slate-200 p-3 bg-slate-50 sticky left-0 z-30">
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                          <Tag size={12} /> Hub Events
                        </p>
                        <p className="text-[8px] text-slate-500 font-mono uppercase mt-1">General Schedule</p>
                      </div>
                      <div className="flex-1 relative flex h-14 items-center">
                        {events.map(ev => {
                          const colors = eventTypeColors[ev.type] || eventTypeColors.general;
                          const itemStartMs = parseLocalDate(ev.startDate, 'start');
                          const itemEndMs = parseLocalDate(ev.endDate, 'end');
                          
                          if (itemEndMs < gridStartMs || itemStartMs > gridEndMs) return null;

                          let leftPercent = (itemStartMs - gridStartMs) / durationMs;
                          let widthPercent = (itemEndMs - itemStartMs + 1000) / durationMs;

                          if (leftPercent < 0) {
                            widthPercent = widthPercent + leftPercent;
                            leftPercent = 0;
                          }
                          if (leftPercent + widthPercent > 1) {
                            widthPercent = 1 - leftPercent;
                          }

                          const left = leftPercent * totalGridWidth;
                          const width = Math.max(widthPercent * totalGridWidth, 12);
                          const showText = width > 45;

                          return (
                            <div 
                              key={ev.id}
                              style={{ left, width }}
                              onClick={(e) => { e.stopPropagation(); handleEditEvent(ev); }}
                              className={cn(
                                "absolute h-8 rounded-lg flex items-center gap-2 px-3 border cursor-pointer hover:scale-[1.02] transition-all z-10 group/ev text-white overflow-hidden",
                                colors.border, colors.bg, colors.text
                              )}
                            >
                              {getEventIcon(ev.type, 10)}
                              {showText && (
                                <span className="text-[9px] font-black uppercase tracking-widest truncate">{ev.title}</span>
                              )}
                              
                              {/* Enhanced Tooltip for Hub Events */}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-white border border-slate-200 p-3 rounded-xl shadow-2xl opacity-0 group-hover/ev:opacity-100 invisible group-hover/ev:visible transition-all z-50 pointer-events-none text-slate-800">
                                 <div className={cn("w-full h-1 absolute top-0 left-0 rounded-t-xl", colors.solid)} />
                                 <div className="flex items-center justify-between mb-1">
                                   <p className="text-[10px] font-black text-black uppercase">{ev.title}</p>
                                   <span className={cn("text-[8px] font-black uppercase tracking-tighter", colors.text)}>{ev.type}</span>
                                 </div>
                                 <p className="text-[9px] text-slate-500 leading-tight mb-2 italic">
                                   {ev.description || 'Global hub-wide event'}
                                 </p>
                                 <div className="flex items-center gap-2 text-[9px] font-mono border-t border-slate-100 pt-2">
                                   <CalendarIcon size={10} className={colors.text} />
                                   <span className="text-black">{formatDate(ev.startDate)}</span>
                                   <span className="text-slate-500">-</span>
                                   <span className="text-black">{formatDate(ev.endDate)}</span>
                                 </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                
                return (
                  <div key={p.id} className="flex group hover:bg-slate-50 relative z-10">
                    <div className="w-48 shrink-0 border-r border-slate-200 p-3 bg-white sticky left-0 z-30">
                      <p className="text-[10px] font-bold text-black uppercase truncate">{p.fullName}</p>
                      <p className={cn(
                        "text-[8px] px-1.5 rounded-sm w-fit font-mono uppercase font-black mt-0.5 text-white",
                        getGroupColor(p.rosterGroup)
                      )}>{p.rosterGroup}</p>
                    </div>
                    <div className="flex-1 relative flex h-12 items-center">
                      {filteredSchedules.filter(s => s.personnelId === p.id).map(s => {
                        const itemStartMs = parseLocalDate(s.startDate, 'start');
                        const itemEndMs = parseLocalDate(s.endDate, 'end');
                        
                        if (itemEndMs < gridStartMs || itemStartMs > gridEndMs) return null;

                        let leftPercent = (itemStartMs - gridStartMs) / durationMs;
                        let widthPercent = (itemEndMs - itemStartMs + 1000) / durationMs;

                        if (leftPercent < 0) {
                          widthPercent = widthPercent + leftPercent;
                          leftPercent = 0;
                        }
                        if (leftPercent + widthPercent > 1) {
                          widthPercent = 1 - leftPercent;
                        }

                        const left = leftPercent * totalGridWidth;
                        const width = Math.max(widthPercent * totalGridWidth, 12);
                        const showDates = width > 100;
                        const showText = width > 40;
                        const isSim = s.id.startsWith('sim-');

                        return (
                          <div 
                            key={s.id}
                            style={{ left, width }}
                            className={cn(
                              "absolute h-7 rounded flex items-center justify-center px-1 group/bar transition-all hover:scale-[1.02] hover:z-20 border overflow-hidden",
                              getScheduleStyle(s, p.rosterGroup),
                              (isGuest && !isSim) ? "cursor-default" : "cursor-pointer"
                            )}
                            onClick={() => handleEdit(s)}
                          >
                            <div className="flex flex-col items-center leading-none max-w-full">
                              {showText && (
                                <span className={cn("font-black uppercase truncate whitespace-nowrap", showDates ? "text-[8px]" : "text-[9px]", isSim ? "text-slate-900" : "text-white")}>
                                  {s.status === 'TRANSIT' ? 'TRANS' : s.status} {isSim ? '(Sim)' : ''}
                                </span>
                              )}
                              {showDates && (
                                <span className={cn("text-[7px] font-mono font-black border-t mt-0.5 pt-0.5 whitespace-nowrap", isSim ? "border-slate-400/40 text-slate-700" : "border-white/20 text-white")}>
                                  {s.startDate.split('-').slice(1).join('/')} - {s.endDate.split('-').slice(1).join('/')}
                                </span>
                              )}
                            </div>

                            {/* Enhanced Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-white border border-slate-200 p-3 rounded-xl shadow-2xl opacity-0 group-hover/bar:opacity-100 invisible group-hover/bar:visible transition-all z-50 pointer-events-none text-slate-800">
                              <div className={cn("w-full h-1 absolute top-0 left-0 rounded-t-xl", getGroupColor(p.rosterGroup))} />
                              <p className="text-[10px] font-black text-black mb-1 uppercase flex items-center gap-1">
                                <span>{p.fullName}</span>
                                {isSim && (
                                  <span className="text-[6px] text-indigo-600 font-extrabold uppercase bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded leading-none shrink-0">
                                    Simulation
                                  </span>
                                )}
                              </p>
                              <div className="flex items-center gap-2 mb-2">
                                 <span className={cn("text-[7px] px-1.5 py-0.5 rounded font-black text-white", getGroupColor(p.rosterGroup))}>{p.rosterGroup}</span>
                                 <span className="text-[8px] font-bold text-slate-500">{isSim ? 'SIMULATED' : s.status}</span>
                              </div>
                              <div className="space-y-1 text-[9px] font-mono border-t border-slate-100 pt-2 text-slate-600">
                                <div className="flex justify-between">
                                  <span className="text-slate-500 font-bold">START:</span>
                                  <span className="text-black">{formatDate(s.startDate)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500 font-bold">END:</span>
                                  <span className="text-black">{formatDate(s.endDate)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const oldRenderGanttView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    // Only show the target month during export to keep the PDF focused
    const monthsToShow = isExporting ? [new Date(year, month, 1)] : [
      new Date(year, month - 1, 1),
      new Date(year, month, 1),
      new Date(year, month + 1, 1)
    ];

    const dayWidth = 32; 
    const timelineDates: { date: Date, dateStr: string, isToday: boolean }[] = [];
    
    monthsToShow.forEach(m => {
       const days = daysInMonth(m.getFullYear(), m.getMonth());
       for(let i=1; i<=days; i++) {
         const d = new Date(m.getFullYear(), m.getMonth(), i);
         const dateStr = toLocalDateStr(d);
         timelineDates.push({ date: d, dateStr, isToday: dateStr === todayStr });
       }
    });

    return (
      <div className="overflow-x-auto custom-scrollbar border rounded-xl relative" ref={ganttRef} style={{ backgroundColor: 'var(--theme-container)', borderColor: 'var(--theme-border)', maxHeight: '700px', overflowY: 'auto' }}>
        <div style={{ width: timelineDates.length * dayWidth + 192 }}>
          {/* Header */}
          <div className="flex border-b border-slate-200 bg-white sticky top-0 z-40">
            <div className="w-48 shrink-0 border-r border-slate-200 p-3 text-[10px] font-black text-black bg-slate-50 uppercase tracking-widest sticky left-0 z-50">Crew Roster</div>
            <div className="flex-1 flex overflow-hidden">
              {monthsToShow.map(m => {
                const days = daysInMonth(m.getFullYear(), m.getMonth());
                return (
                  <div key={m.getTime()} style={{ width: days * dayWidth }} className="shrink-0 text-center text-[9px] font-black text-black py-3 bg-slate-50/50 border-r border-slate-200 uppercase">
                    {m.toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex border-b border-slate-200 bg-white sticky top-[42px] z-40">
            <div className="w-48 shrink-0 border-r border-slate-200 sticky left-0 z-50 bg-white"></div>
            <div className="flex-1 flex">
              {timelineDates.map(({ date, isToday }, i) => (
                <div key={i} style={{ width: dayWidth }} className={cn(
                  "shrink-0 text-center text-[8px] font-bold py-1.5 border-r border-slate-200 relative",
                  isToday ? "bg-emerald-500/20 text-emerald-600" : (date.getDay() === 0 || date.getDay() === 6 ? "bg-slate-50 text-slate-400" : "text-black")
                )}>
                  {date.getDate()}
                  {isToday && (
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-emerald-500 animate-pulse" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Today Indicator Line (Full Height) */}
          {(() => {
            const todayIdx = timelineDates.findIndex(td => td.isToday);
            if (todayIdx === -1) return null;
            return (
              <div 
                className="absolute top-0 bottom-0 z-20 w-px bg-emerald-500/40 pointer-events-none"
                style={{ left: 192 + todayIdx * dayWidth + (dayWidth / 2) }}
              >
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full -ml-[3px] mt-[42px] animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              </div>
            );
          })()}

          {/* Rows */}
          <div className="divide-y divide-slate-200 relative">
            {/* Vertical Separators Grid */}
            <div className="absolute inset-0 pointer-events-none flex" style={{ left: 192 }}>
              {timelineDates.map((_, i) => (
                <div key={i} style={{ width: dayWidth }} className="h-full border-r border-slate-200 shrink-0" />
              ))}
            </div>

            {/* Integrated Rows */}
            {sortedPersonnel.map(p => {
              if (p.id === 'HUB_EVENTS') {
                return (
                  <div key="HUB_EVENTS" className="flex group hover:bg-slate-50 relative z-20">
                    <div className="w-48 shrink-0 border-r border-slate-200 p-3 bg-slate-50 sticky left-0 z-30">
                      <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                        <Tag size={12} /> Hub Events
                      </p>
                      <p className="text-[8px] text-slate-500 font-mono uppercase mt-1">General Schedule</p>
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
                              "absolute h-8 rounded-lg flex items-center gap-2 px-3 border cursor-pointer hover:scale-[1.02] transition-all z-10 group/ev text-white",
                              colors.border, colors.bg, colors.text
                            )}
                          >
                            {getEventIcon(ev.type, 10)}
                            <span className="text-[9px] font-black uppercase tracking-widest truncate">{ev.title}</span>
                            
                            {/* Enhanced Tooltip for Hub Events */}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-white border border-slate-200 p-3 rounded-xl shadow-2xl opacity-0 group-hover/ev:opacity-100 invisible group-hover/ev:visible transition-all z-50 pointer-events-none">
                               <div className={cn("w-full h-1 absolute top-0 left-0 rounded-t-xl", colors.solid)} />
                               <div className="flex items-center justify-between mb-1">
                                 <p className="text-[10px] font-black text-black uppercase">{ev.title}</p>
                                 <span className={cn("text-[8px] font-black uppercase tracking-tighter", colors.text)}>{ev.type}</span>
                               </div>
                               <p className="text-[9px] text-slate-500 leading-tight mb-2 italic">
                                 {ev.description || 'Global hub-wide event'}
                               </p>
                               <div className="flex items-center gap-2 text-[9px] font-mono border-t border-slate-100 pt-2">
                                 <CalendarIcon size={10} className={colors.text} />
                                 <span className="text-black">{formatDate(ev.startDate)}</span>
                                 <span className="text-slate-500">-</span>
                                 <span className="text-black">{formatDate(ev.endDate)}</span>
                               </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              
              return (
                <div key={p.id} className="flex group hover:bg-slate-50 relative z-10">
                  <div className="w-48 shrink-0 border-r border-slate-200 p-3 bg-white sticky left-0 z-30">
                    <p className="text-[10px] font-bold text-black uppercase truncate">{p.fullName}</p>
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

                    const isSim = s.id.startsWith('sim-');
                    return (
                      <div 
                        key={s.id}
                        style={{ left, width }}
                        className={cn(
                          "absolute h-7 rounded flex items-center justify-center px-1 group/bar transition-all hover:scale-[1.02] hover:z-20 border",
                          getScheduleStyle(s, p.rosterGroup),
                          (isGuest && !isSim) ? "cursor-default" : "cursor-pointer"
                        )}
                        onClick={() => handleEdit(s)}
                      >
                        <div className="flex flex-col items-center leading-none">
                          <span className={cn("font-black uppercase tracking-[0.1em] whitespace-nowrap", showDates ? "text-[8px]" : "text-[9px]", isSim ? "text-slate-900" : "text-white")}>
                            {s.status === 'TRANSIT' ? 'TRANS' : s.status} {isSim ? '(Simulation)' : ''}
                          </span>
                          {showDates && (
                            <span className={cn("text-[7px] font-mono font-black border-t mt-0.5 pt-0.5 whitespace-nowrap", isSim ? "border-slate-400/40 text-slate-700" : "border-white/20 text-white")}>
                              {s.startDate.split('-').slice(1).join('/')} - {s.endDate.split('-').slice(1).join('/')}
                            </span>
                          )}
                        </div>

                        {/* Enhanced Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-white border border-slate-200 p-3 rounded-xl shadow-2xl opacity-0 group-hover/bar:opacity-100 invisible group-hover/bar:visible transition-all z-50 pointer-events-none text-slate-800">
                          <div className={cn("w-full h-1 absolute top-0 left-0 rounded-t-xl", getGroupColor(p.rosterGroup))} />
                          <p className="text-[10px] font-black text-black mb-1 uppercase flex items-center gap-1">
                            <span>{p.fullName}</span>
                            {isSim && (
                              <span className="text-[6px] text-indigo-600 font-extrabold uppercase bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded leading-none shrink-0">
                                Simulation
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-2 mb-2">
                             <span className={cn("text-[7px] px-1.5 py-0.5 rounded font-black text-white", getGroupColor(p.rosterGroup))}>{p.rosterGroup}</span>
                             <span className="text-[8px] font-bold text-slate-500">{isSim ? 'SIMULATED' : s.status}</span>
                          </div>
                          <div className="space-y-1 text-[9px] font-mono border-t border-slate-100 pt-2 text-slate-600">
                            <div className="flex justify-between">
                              <span className="text-slate-500 font-bold">START:</span>
                              <span className="text-black">{formatDate(s.startDate)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500 font-bold">END:</span>
                              <span className="text-black">{formatDate(s.endDate)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters Bar */}
      <div className="flex flex-wrap items-center gap-4 bg-[var(--theme-card)] border border-[var(--theme-border)] p-4 rounded-2xl">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]" size={14} />
          <select 
            value={filterPersonnel}
            onChange={(e) => setFilterPersonnel(e.target.value)}
            className="w-full bg-[var(--theme-container)] border border-[var(--theme-border)] rounded-xl pl-10 pr-4 py-2 text-[10px] font-black text-[var(--theme-text)] uppercase tracking-widest focus:outline-none focus:border-blue-500 transition-all appearance-none"
          >
            <option value="ALL">All Crew Members</option>
            {personnel.map(p => (
              <option key={p.id} value={p.id}>{p.fullName}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]" size={14} />
            <select 
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="bg-[var(--theme-container)] border border-[var(--theme-border)] rounded-xl pl-10 pr-8 py-2 text-[10px] font-black text-[var(--theme-text)] uppercase tracking-widest focus:outline-none focus:border-blue-500 appearance-none"
            >
              <option value="ALL">All Groups</option>
              {uniqueGroups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <SortAsc className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--theme-text-muted)]" size={14} />
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-[var(--theme-container)] border border-[var(--theme-border)] rounded-xl pl-10 pr-8 py-2 text-[10px] font-black text-[var(--theme-text)] uppercase tracking-widest focus:outline-none focus:border-blue-500 appearance-none"
            >
              <option value="name">Sort by Name</option>
              <option value="group">Sort by Group</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button 
            onClick={() => setShowGlobalEvents(!showGlobalEvents)}
            className={cn(
              "p-2 rounded-xl border transition-all flex items-center gap-2 text-[9px] font-black uppercase tracking-widest",
              showGlobalEvents ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-[var(--theme-status)] border-[var(--theme-border)] text-[var(--theme-text-muted)]"
            )}
            title="Toggle Global Events"
          >
            {showGlobalEvents ? <Eye size={14} /> : <EyeOff size={14} />}
            <span className="hidden sm:inline">Global Events</span>
          </button>

          <div className="h-6 w-px bg-[var(--theme-border)] mx-2" />

          <button 
            onClick={handleCopyToClipboard}
            className="p-2 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl hover:bg-[var(--theme-card)] text-[var(--theme-text-muted)] transition-all flex items-center gap-2"
            title="Copy Summary"
          >
            <Copy size={14} />
            <span className="text-[9px] font-black uppercase tracking-widest hidden sm:inline">Copy</span>
          </button>

          <button 
            onClick={handleExportPDF}
            disabled={isExporting}
            className={cn(
              "p-2 bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl hover:bg-[var(--theme-card)] text-[var(--theme-text-muted)] transition-all flex items-center gap-2",
              isExporting && "opacity-50 cursor-not-allowed"
            )}
            title="Export as PDF"
          >
            <FileDown size={14} />
            <span className="text-[9px] font-black uppercase tracking-widest hidden sm:inline">
              {isExporting ? 'EXPORTING...' : 'PDF'}
            </span>
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 md:gap-6">
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
          <div className="flex items-center gap-2 md:gap-4 flex-1 lg:flex-none justify-between lg:justify-start bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-xl px-3 py-1.5 md:px-0 md:py-0 md:bg-transparent md:border-none">
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
            {isGuest ? (
              <div className="flex gap-2 w-full xs:w-auto">
                <div className="relative group/add flex-1 xs:flex-none">
                  <button 
                    onClick={() => handleOpenAdd(undefined, undefined, true)}
                    className="w-full flex items-center justify-center gap-2 bg-[#0F172A] hover:bg-[#1E293B] text-white px-2.5 md:px-4 py-2 md:py-2.5 rounded-lg text-[7px] md:text-[10px] font-black uppercase tracking-widest transition-all shadow-lg border border-slate-700 hover:scale-[1.02]"
                    title="Simulate Adding Crew Duty"
                  >
                    <Plus size={12} /> <span className="hidden sm:inline">⚡ Simulate Roster Duty</span><span className="sm:hidden">⚡ Duty</span>
                  </button>
                </div>

                <div className="relative group/event-btn flex-1 xs:flex-none">
                  <button 
                    onClick={() => handleOpenAddEvent(undefined, true)}
                    className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-2.5 md:px-4 py-2 md:py-2.5 rounded-lg text-[7px] md:text-[10px] font-black uppercase tracking-widest transition-all shadow-lg hover:scale-[1.02]"
                    title="Simulate Adding Hub Event"
                  >
                    <Tag size={10} /> <span className="hidden sm:inline">⚡ Simulate Event</span><span className="sm:hidden">⚡ Event</span>
                  </button>
                </div>
              </div>
            ) : (
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
              className="relative w-full max-w-md bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-[var(--theme-text)] uppercase tracking-widest flex items-center gap-3">
                  <Tag size={18} className="text-emerald-500" />
                  {editingEvent ? 'Edit Hub Event' : 'Create Hub Event'}
                </h3>
                <button onClick={() => setIsEventModalOpen(false)} className="p-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmitEvent(onSaveEvent)} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Event Title</label>
                  <input {...registerEvent('title')} className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-4 py-2.5 text-sm text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-emerald-500/30" placeholder="e.g. Rig Maintenance" />
                  {eventErrors.title && <p className="text-[10px] text-rose-500 px-1">{eventErrors.title.message}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Description</label>
                  <textarea {...registerEvent('description')} className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-4 py-2.5 text-sm text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-emerald-500/30 min-h-[80px] resize-none" placeholder="Provide event details..." />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">
                      {watchRecurrence === 'none' ? 'Start Date' : 'Series Start Date'}
                    </label>
                    <input type="date" {...registerEvent('startDate')} className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-4 py-2.5 text-sm text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-emerald-500/30" />
                    {eventErrors.startDate && <p className="text-[10px] text-rose-500 px-1">{eventErrors.startDate.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">
                      {watchRecurrence === 'none' ? 'End Date' : 'Series End Date'}
                    </label>
                    <input type="date" {...registerEvent('endDate')} className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-4 py-2.5 text-sm text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-emerald-500/30" />
                    {eventErrors.endDate && <p className="text-[10px] text-rose-500 px-1">{eventErrors.endDate.message}</p>}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Location</label>
                  <select 
                    {...registerEvent('location')}
                    className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-4 py-2.5 text-sm text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-emerald-500/30"
                  >
                    <option value="Algiers">Algiers</option>
                    <option value="Hassi Messaoud">Hassi Messaoud</option>
                    <option value="MLN">MLN</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Recurrence</label>
                  <select 
                    {...registerEvent('recurrence')}
                    disabled={!!editingEvent}
                    className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-4 py-2.5 text-sm text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-emerald-500/30 disabled:opacity-50"
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
              className="relative w-full max-w-md bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-[var(--theme-text)] uppercase tracking-widest flex items-center gap-3">
                  <CalendarIcon size={18} className="text-blue-500" />
                  {editingSchedule ? 'Edit Duty Period' : 'Assign Duty Period'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSaveSchedule)} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Select Personnel (Multi-select enabled)</label>
                  <div className="max-h-[150px] overflow-y-auto custom-scrollbar border border-[var(--theme-border)] bg-[var(--theme-status)] rounded-lg p-2 space-y-1">
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
                           <span className="text-[11px] font-bold text-[var(--theme-text-muted)] group-hover:text-[var(--theme-text)] transition-colors">{p.fullName}</span>
                           <span className="text-[9px] text-[var(--theme-text-muted)] uppercase font-mono opacity-60">{p.rosterGroup} • {p.title}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  {errors.personnelIds && <p className="text-[10px] text-rose-500 px-1">{errors.personnelIds.message}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Start Date</label>
                    <input type="date" {...register('startDate')} className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-4 py-2.5 text-sm text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-blue-500/30" />
                    {errors.startDate && <p className="text-[10px] text-rose-500 px-1">{errors.startDate.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">End Date</label>
                    <input type="date" {...register('endDate')} className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-4 py-2.5 text-sm text-[var(--theme-text)] rounded-lg focus:outline-none focus:border-blue-500/30" />
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
                      onClick={() => handleDelete(editingSchedule.id)}
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
      <AnimatePresence>
        {selectedDayDetails && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDayDetails(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
            >
              <div className="p-6 border-b border-[var(--theme-border)] bg-gradient-to-r from-blue-600/10 to-emerald-600/10 flex items-center justify-between">
                <div>
                   <h3 className="text-xl font-black text-[var(--theme-text)] uppercase tracking-widest flex items-center gap-3">
                     <CalendarIcon className="text-blue-500" />
                     {formatDate(selectedDayDetails)}
                   </h3>
                   <p className="text-[10px] text-[var(--theme-text-muted)] font-bold uppercase tracking-[0.2em] mt-1 ml-9">Daily Activity Overview</p>
                </div>
                <button onClick={() => setSelectedDayDetails(null)} className="p-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors bg-[var(--theme-status)] rounded-xl">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                {/* Hub Events Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4 border-l-4 border-emerald-500 pl-4">
                    <h4 className="text-xs font-black text-emerald-500 uppercase tracking-widest">Hub Events</h4>
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-2 rounded-full font-bold">
                      {events.filter(e => selectedDayDetails >= e.startDate && selectedDayDetails <= e.endDate).length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {events.filter(e => selectedDayDetails >= e.startDate && selectedDayDetails <= e.endDate).map(ev => {
                      const colors = eventTypeColors[ev.type] || eventTypeColors.general;
                      return (
                        <div key={ev.id} className={cn("p-4 rounded-xl border flex gap-4 bg-[var(--theme-status)]", colors.border)}>
                           <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", colors.bg)}>
                              {getEventIcon(ev.type, 20)}
                           </div>
                           <div className="min-w-0 flex-1">
                              <p className={cn("text-[8px] font-black uppercase tracking-widest mb-1", colors.text)}>{ev.type}</p>
                              <h5 className="text-sm font-bold text-[var(--theme-text)] truncate">{ev.title}</h5>
                              <p className="text-[10px] text-[var(--theme-text-muted)] mt-1 line-clamp-2 leading-relaxed font-medium">{ev.description || 'No additional details provided for this event.'}</p>
                              <div className="mt-3 pt-3 border-t border-[var(--theme-border)] flex items-center justify-between">
                                 <span className="text-[9px] font-mono text-[var(--theme-text-muted)]">{formatDate(ev.startDate)}</span>
                                 <button onClick={() => { setSelectedDayDetails(null); handleEditEvent(ev); }} className="text-[8px] font-black text-[var(--theme-text)] px-2 py-1 bg-[var(--theme-container)] hover:bg-[var(--theme-card)] rounded uppercase transition-colors">Edit Event</button>
                              </div>
                           </div>
                        </div>
                      );
                    })}
                    {events.filter(e => selectedDayDetails >= e.startDate && selectedDayDetails <= e.endDate).length === 0 && (
                      <div className="col-span-full py-8 text-center bg-[var(--theme-status)] border border-dashed border-[var(--theme-border)] rounded-xl">
                        <Tag size={24} className="mx-auto text-[var(--theme-text-muted)] mb-2 opacity-20" />
                        <p className="text-[10px] text-[var(--theme-text-muted)] font-bold uppercase tracking-widest">No global events scheduled for this day</p>
                      </div>
                    )}
                  </div>
                </section>

                {/* Personnel on Duty Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4 border-l-4 border-blue-500 pl-4">
                    <h4 className="text-xs font-black text-blue-500 uppercase tracking-widest">Personnel on Duty</h4>
                    <span className="text-[9px] bg-blue-500/10 text-blue-500 px-2 rounded-full font-bold">
                      {filteredSchedules.filter(s => selectedDayDetails >= s.startDate && selectedDayDetails <= s.endDate).length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredSchedules.filter(s => selectedDayDetails >= s.startDate && selectedDayDetails <= s.endDate).map(s => {
                      const p = personnel.find(pers => pers.id === s.personnelId);
                      if (!p) return null;
                      const isSim = s.id.startsWith('sim-');
                      return (
                        <div 
                          key={s.id} 
                          className={cn(
                            "p-3 rounded-xl border group transition-all flex flex-col justify-between",
                            isSim 
                              ? `${getScheduleStyle(s, p.rosterGroup)} relative overflow-hidden bg-white/5`
                              : "bg-[var(--theme-status)] border-[var(--theme-border)] hover:border-blue-500/30"
                          )}
                        >
                           <div className="mb-4">
                              <div className="flex items-center justify-between mb-2">
                                 <span className={cn(
                                   "text-[8px] px-2 py-0.5 rounded-full font-black text-white",
                                   getGroupColor(p.rosterGroup)
                                 )}>
                                   {p.rosterGroup}
                                 </span>
                                 <span className={cn(
                                   "text-[8px] font-black uppercase px-2 py-0.5 rounded border",
                                   isSim 
                                     ? "bg-indigo-50 border-indigo-200 text-indigo-900 font-extrabold"
                                     : s.status === 'TRANSIT' ? "bg-blue-600 font-black text-white border-white/10" : "bg-emerald-600 font-black text-white border-white/10"
                                 )}>
                                   {isSim ? "SIMULATION" : s.status}
                                 </span>
                              </div>
                              <h5 className={cn("text-xs font-bold uppercase truncate", isSim ? "text-slate-900" : "text-[var(--theme-text)]")}>
                                {p.fullName} {isSim && <span className="text-[7px] text-indigo-600 font-extrabold uppercase bg-indigo-50 px-1 py-0.5 rounded ml-1 tracking-normal border border-indigo-200">Simulation</span>}
                              </h5>
                              <p className={cn("text-[10px] font-mono mt-0.5", isSim ? "text-slate-700 font-semibold" : "text-[var(--theme-text-muted)]")}>{p.title}</p>
                           </div>
                           <div className="pt-3 border-t border-[var(--theme-border)] flex items-center justify-between">
                              <p className={cn("text-[8px] font-mono italic", isSim ? "text-slate-600" : "text-[var(--theme-text-muted)]")}>Ends: {formatDate(s.endDate)}</p>
                              <button onClick={() => { setSelectedDayDetails(null); handleEdit(s); }} className="text-[9px] font-black text-blue-500 opacity-0 group-hover:opacity-100 uppercase transition-all">Go to Duty</button>
                           </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              <div className="p-6 border-t border-[var(--theme-border)] bg-[var(--theme-status)] flex gap-4">
                 {isGuest ? (
                   <>
                     <button 
                       onClick={() => { setSelectedDayDetails(null); handleOpenAdd(selectedDayDetails, undefined, true); }}
                       className="flex-1 py-3 bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20"
                     >
                       ⚡ Simulate Duty
                     </button>
                     <button 
                       onClick={() => { setSelectedDayDetails(null); handleOpenAddEvent(selectedDayDetails, true); }}
                       className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-purple-500/20"
                     >
                       ⚡ Simulate Event
                     </button>
                   </>
                 ) : (
                   <>
                     <button 
                       onClick={() => { setSelectedDayDetails(null); handleOpenAdd(selectedDayDetails); }}
                       className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20"
                     >
                       Assign Duty
                     </button>
                     <button 
                       onClick={() => { setSelectedDayDetails(null); handleOpenAddEvent(selectedDayDetails); }}
                       className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
                     >
                       Schedule Event
                     </button>
                   </>
                 )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Export Settings Modal */}
      <AnimatePresence>
        {isExportSettingsOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsExportSettingsOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="relative w-full max-w-sm bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-[var(--theme-text)] uppercase tracking-widest flex items-center gap-3">
                  <FileDown size={18} className="text-blue-500" />
                  PDF Export Options
                </h3>
                <button onClick={() => setIsExportSettingsOpen(false)} className="p-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                {/* Start Month Selection */}
                <div className="space-y-2">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">Start Month</label>
                  <div className="grid grid-cols-2 gap-3">
                    <select 
                      value={exportStartMonth}
                      onChange={(e) => setExportStartMonth(parseInt(e.target.value))}
                      className="bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl px-4 py-2.5 text-xs font-black text-[var(--theme-text)] uppercase tracking-widest focus:outline-none focus:border-blue-500"
                    >
                      {Array.from({ length: 12 }).map((_, i) => (
                        <option key={i} value={i} className="bg-[var(--theme-container)]">
                          {new Date(2000, i).toLocaleString('default', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                    <select 
                      value={exportStartYear}
                      onChange={(e) => setExportStartYear(parseInt(e.target.value))}
                      className="bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl px-4 py-2.5 text-xs font-black text-[var(--theme-text)] uppercase tracking-widest focus:outline-none focus:border-blue-500"
                    >
                      {[2024, 2025, 2026, 2027].map(y => (
                        <option key={y} value={y} className="bg-[var(--theme-container)]">{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* End Month Selection */}
                <div className="space-y-2">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-bold px-1">End Month</label>
                  <div className="grid grid-cols-2 gap-3">
                    <select 
                      value={exportEndMonth}
                      onChange={(e) => setExportEndMonth(parseInt(e.target.value))}
                      className="bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl px-4 py-2.5 text-xs font-black text-[var(--theme-text)] uppercase tracking-widest focus:outline-none focus:border-blue-500"
                    >
                      {Array.from({ length: 12 }).map((_, i) => (
                        <option key={i} value={i} className="bg-[var(--theme-container)]">
                          {new Date(2000, i).toLocaleString('default', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                    <select 
                      value={exportEndYear}
                      onChange={(e) => setExportEndYear(parseInt(e.target.value))}
                      className="bg-[var(--theme-status)] border border-[var(--theme-border)] rounded-xl px-4 py-2.5 text-xs font-black text-[var(--theme-text)] uppercase tracking-widest focus:outline-none focus:border-blue-500"
                    >
                      {[2024, 2025, 2026, 2027].map(y => (
                        <option key={y} value={y} className="bg-[var(--theme-container)]">{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-xl">
                  <p className="text-[9px] text-blue-400 font-bold leading-relaxed uppercase italic">
                    The export will capture the Gantt chart for the range of months selected. Multi-month export will generate a multi-page PDF document, automatically split with one month per page.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={() => setIsExportSettingsOpen(false)}
                    className="flex-1 px-4 py-3 rounded-xl bg-black border border-white/5 text-slate-400 text-xs font-bold uppercase tracking-widest hover:text-white transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmExport}
                    className="flex-[2] px-4 py-3 rounded-xl bg-blue-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/40"
                  >
                    Start Export
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
