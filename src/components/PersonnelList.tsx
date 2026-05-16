import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Personnel } from '../types';
import { CrewCalendar } from './CrewCalendar';
import { Plus, Search, MoreVertical, UserPlus, Trash2, Mail, Phone, Briefcase, Database, LayoutGrid, Calendar as CalendarIcon, Pencil } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { motion, AnimatePresence } from 'motion/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn } from '../lib/utils';

const personnelSchema = z.object({
  fullName: z.string().min(2, 'Name is too short').max(100),
  title: z.string().min(2, 'Title is too short'),
  email: z.string().email('Invalid email address'),
  rosterGroup: z.string().min(1, 'Roster Group is required'),
  lat: z.any().optional(),
  lng: z.any().optional(),
});

type PersonnelFormData = z.infer<typeof personnelSchema>;

interface PersonnelListProps {
  isGuest?: boolean;
}

export function PersonnelList({ isGuest }: PersonnelListProps) {
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<Personnel | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewType, setViewType] = useState<'grid' | 'calendar'>('grid');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<PersonnelFormData>({
    resolver: zodResolver(personnelSchema),
  });

  useEffect(() => {
    const q = query(collection(db, 'personnel'));
    const unsub = onSnapshot(q, (snap) => {
      setPersonnel(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Personnel)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'personnel');
    });
    return unsub;
  }, []);

  const onSubmit = async (data: PersonnelFormData) => {
    try {
      const formattedData = {
        ...data,
        lat: data.lat ? Number(data.lat) : null,
        lng: data.lng ? Number(data.lng) : null,
      };

      if (editingPersonnel) {
        await updateDoc(doc(db, 'personnel', editingPersonnel.id), formattedData);
      } else {
        await addDoc(collection(db, 'personnel'), formattedData);
      }
      handleCloseModal();
    } catch (error) {
       handleFirestoreError(error, editingPersonnel ? OperationType.UPDATE : OperationType.CREATE, editingPersonnel ? `personnel/${editingPersonnel.id}` : 'personnel');
    }
  };

  const handleEdit = (p: Personnel) => {
    setEditingPersonnel(p);
    setValue('fullName', p.fullName);
    setValue('title', p.title);
    setValue('email', p.email);
    setValue('rosterGroup', p.rosterGroup);
    setValue('lat', p.lat);
    setValue('lng', p.lng);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingPersonnel(null);
    reset();
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteDoc(doc(db, 'personnel', deleteConfirmId));
      setDeleteConfirmId(null);
    } catch (error) {
       handleFirestoreError(error, OperationType.DELETE, `personnel/${deleteConfirmId}`);
    }
  };

  const filteredPersonnel = personnel.filter(p => 
    p.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.rosterGroup.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--theme-text)]">Personnel Dashboard</h2>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Crew Roster Management</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 md:gap-4 w-full md:w-auto">
          <div className="flex bg-[var(--theme-status)] border border-[var(--theme-border)] p-1 rounded-lg md:rounded-xl shadow-inner group flex-1 md:flex-none">
            <button 
              onClick={() => setViewType('grid')}
              className={cn(
                "flex items-center justify-center gap-1.5 md:gap-2 px-2.5 md:px-5 py-1.5 md:py-2.5 rounded-md md:rounded-lg transition-all text-[8px] md:text-[11px] font-black uppercase tracking-widest whitespace-nowrap flex-1 md:flex-none", 
                viewType === 'grid' 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                  : "text-slate-500 hover:text-slate-700 hover:bg-white"
              )}
            >
              <LayoutGrid size={12} className="md:w-[16px] md:h-[16px]" />
              <span>Drilling Crews</span>
            </button>
            <button 
              onClick={() => setViewType('calendar')}
              className={cn(
                "flex items-center justify-center gap-1.5 md:gap-2 px-2.5 md:px-5 py-1.5 md:py-2.5 rounded-md md:rounded-lg transition-all text-[8px] md:text-[11px] font-black uppercase tracking-widest whitespace-nowrap flex-1 md:flex-none", 
                viewType === 'calendar' 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40" 
                  : "text-slate-500 hover:text-slate-700 hover:bg-white"
              )}
            >
              <CalendarIcon size={12} className="md:w-[16px] md:h-[16px]" />
              <span>Schedule</span>
            </button>
          </div>

          <div className="relative flex-1 md:flex-none min-w-[120px] md:min-w-[250px] order-3 md:order-2 w-full md:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
            <input 
              type="text" 
              placeholder="SEARCH..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[var(--theme-card)] border border-[var(--theme-border)] pl-9 pr-4 py-2 text-[9px] md:text-[10px] font-mono text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-blue-500/50 w-full md:w-64 transition-all rounded-lg shadow-sm"
            />
          </div>
          {!isGuest && (
            <button 
              onClick={() => setIsModalOpen(true)}
              className="btn-primary py-2 px-3 md:px-4 text-[9px] md:text-[10px] whitespace-nowrap order-2 md:order-3 md:flex-none"
            >
              + Crew
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {viewType === 'calendar' ? (
        <CrewCalendar isGuest={isGuest} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <AnimatePresence>
            {filteredPersonnel.map((p, i) => (
              <motion.div
                layout
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: i * 0.02 }}
                className="bg-[var(--theme-card)] border border-[var(--theme-border)] p-4 sm:p-6 rounded-2xl sm:rounded-3xl group relative hover:border-blue-200 transition-all shadow-sm hover:shadow-xl hover:shadow-black/5"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shadow-inner">
                    <Briefcase size={18} />
                  </div>
                  {!isGuest && (
                    <div className="flex gap-1 translate-x-2 -translate-y-2">
                      <button 
                        onClick={() => handleEdit(p)}
                        className="p-2 text-slate-400 hover:text-blue-600 text-[9px] uppercase font-black tracking-widest transition-colors flex items-center gap-1.5 bg-slate-50 hover:bg-white rounded-lg border border-transparent hover:border-slate-100"
                      >
                        <Pencil size={10} /> Edit
                      </button>
                      <button 
                        onClick={() => {
                          setDeleteConfirmId(p.id);
                        }}
                        className="p-2 text-slate-400 hover:text-rose-600 text-[9px] uppercase font-black tracking-widest transition-colors bg-slate-50 hover:bg-white rounded-lg border border-transparent hover:border-slate-100"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <h3 className="text-[14px] font-black text-[var(--theme-text)] tracking-tight uppercase leading-tight">{p.fullName}</h3>
                  <p className="text-[9px] text-blue-600 font-black uppercase tracking-[0.2em]">{p.title}</p>
                </div>

                <div className="mt-6 pt-6 border-t border-[var(--theme-border)] space-y-3">
                  <div className="flex items-center gap-3 text-[9px] text-[var(--theme-text-muted)] font-black uppercase tracking-widest bg-[var(--theme-status)] p-2.5 rounded-xl">
                    <Database size={10} className="text-blue-400" />
                    <span>GROUP: <span className="text-[var(--theme-text)]">{p.rosterGroup}</span></span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-[var(--theme-text-muted)] font-medium px-1">
                    <Mail size={11} className="text-[var(--theme-text-muted)] opacity-50" />
                    <span className="truncate">{p.email}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={handleCloseModal}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-[var(--theme-card)] border border-[var(--theme-border)] p-10 rounded-[2.5rem] shadow-[0_50px_100px_rgba(0,0,0,0.3)]"
            >
              <h3 className="text-xl font-black text-[var(--theme-text)] uppercase tracking-tight mb-8">
                {editingPersonnel ? 'Edit Drilling Crew' : 'Drilling Crew Entry'}
              </h3>
              
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-black tracking-widest px-1">Full Name</label>
                  <input {...register('fullName')} placeholder="Enter full name" className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-5 py-3.5 text-sm text-[var(--theme-text)] rounded-2xl focus:outline-none focus:border-blue-500/30 transition-all font-medium" />
                  {errors.fullName && <p className="text-[10px] text-rose-500 font-bold mt-1 px-1">{errors.fullName.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-black tracking-widest px-1">Title</label>
                  <input {...register('title')} placeholder="Job title / position" className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-5 py-3.5 text-sm text-[var(--theme-text)] rounded-2xl focus:outline-none focus:border-blue-500/30 transition-all font-medium" />
                  {errors.title && <p className="text-[10px] text-rose-500 font-bold mt-1 px-1">{errors.title.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-black tracking-widest px-1">Email Address</label>
                  <input {...register('email')} placeholder="email@example.com" className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-5 py-3.5 text-sm text-[var(--theme-text)] rounded-2xl focus:outline-none focus:border-blue-500/30 transition-all font-medium" />
                  {errors.email && <p className="text-[10px] text-rose-500 font-bold mt-1 px-1">{errors.email.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-black tracking-widest px-1">Roster Group</label>
                  <select 
                    {...register('rosterGroup')} 
                    className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-5 py-3.5 text-sm text-[var(--theme-text)] rounded-2xl focus:outline-none focus:border-blue-500/30 transition-all font-medium appearance-none"
                  >
                    <option value="">Select Group...</option>
                    <option value="Group A">Group A</option>
                    <option value="Group B">Group B</option>
                    <option value="Group C">Group C</option>
                    <option value="Group D">Group D</option>
                    <option value="Others">Others</option>
                  </select>
                  {errors.rosterGroup && <p className="text-[10px] text-rose-500 font-bold mt-1 px-1">{errors.rosterGroup.message}</p>}
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-black tracking-widest px-1">Latitude</label>
                    <input {...register('lat')} step="0.000001" type="number" placeholder="e.g. 31.67" className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-5 py-3.5 text-sm text-[var(--theme-text)] rounded-2xl focus:outline-none focus:border-blue-500/30 transition-all font-mono" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-[var(--theme-text-muted)] uppercase font-black tracking-widest px-1">Longitude</label>
                    <input {...register('lng')} step="0.000001" type="number" placeholder="e.g. 6.07" className="w-full bg-[var(--theme-status)] border border-[var(--theme-border)] px-5 py-3.5 text-sm text-[var(--theme-text)] rounded-2xl focus:outline-none focus:border-blue-500/30 transition-all font-mono" />
                  </div>
                </div>
                
                <div className="flex justify-end gap-3 pt-10">
                  <button type="button" onClick={handleCloseModal} className="px-6 py-3 text-[11px] font-black text-[var(--theme-text-muted)] hover:text-rose-500 uppercase tracking-widest transition-colors">Discard</button>
                  <button type="submit" className="px-8 py-3 bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest rounded-2xl hover:opacity-90 transition-all shadow-xl shadow-blue-900/20">
                    {editingPersonnel ? 'Update Member' : 'Add Member'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal 
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={handleDelete}
        title="Personnel Decommissioning"
        message="This operation will permanently remove the personnel record and all associated flight historical data from the terminal. This cannot be undone."
        confirmText="Confirm Deletion"
      />
    </div>
  );
}
