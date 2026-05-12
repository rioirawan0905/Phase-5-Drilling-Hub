import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { collection, getDocs, deleteDoc, doc, writeBatch, addDoc, serverTimestamp, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Trash2, UserPlus, Mail, Shield, Palette, CheckCircle2, Lock, Clock, UserCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface SettingsProps {
  user: User;
  isGuest?: boolean;
  onLogout: () => void;
}

export function Settings({ user, isGuest, onLogout }: SettingsProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [accessLevel, setAccessLevel] = useState<'admin' | 'guest'>('admin');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('app-theme') || 'dark-pro');
  const [collaborators, setCollaborators] = useState<any[]>([]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme === 'dark-pro' ? '' : currentTheme);
    localStorage.setItem('app-theme', currentTheme);
  }, [currentTheme]);

  useEffect(() => {
    const q = query(collection(db, 'collaborators'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setCollaborators(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, []);

  const themes = [
    { id: 'dark-pro', name: 'Dark Pro', colors: ['#0a0a0c', '#111114', '#3b82f6'] },
    { id: 'high-contrast', name: 'High Contrast', colors: ['#000000', '#111111', '#ffffff'] },
    { id: 'cyberpunk', name: 'Cyberpunk', colors: ['#050505', '#1a0033', '#ff00ff'] },
    { id: 'minimalist', name: 'Minimalist', colors: ['#ffffff', '#f8fafc', '#000000'], light: true },
    { id: 'corporate', name: 'Corporate Blue', colors: ['#f8fafc', '#ffffff', '#1e3a8a'], light: true },
  ];

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || isGuest) return;
    setIsInviting(true);
    
    try {
      // Create a collaborative entry in Firestore
      await addDoc(collection(db, 'collaborators'), {
        email: inviteEmail.toLowerCase(),
        role: accessLevel,
        invitedBy: user.email,
        createdAt: serverTimestamp(),
        status: 'pending'
      });

      setIsInviting(false);
      setInviteSuccess(true);
      setInviteEmail('');
      setTimeout(() => setInviteSuccess(false), 3000);
    } catch (error) {
      console.error("Failed to store invitation:", error);
      setIsInviting(false);
      alert("Error processing invitation. Please check your network.");
    }
  };

  const removeCollaborator = async (id: string) => {
    if (isGuest) return;
    if (confirm('Revoke access for this user?')) {
      await deleteDoc(doc(db, 'collaborators', id));
    }
  };

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    try {
      const collections = ['personnel', 'flightRequests', 'schedules'];
      for (const colName of collections) {
        const querySnapshot = await getDocs(collection(db, colName));
        console.log(`Found ${querySnapshot.size} docs in ${colName}`);
        
        // Chunk deletions to avoid batch limits or timeouts
        const docs = querySnapshot.docs;
        for (let i = 0; i < docs.length; i += 50) {
          const batch = writeBatch(db);
          const chunk = docs.slice(i, i + 50);
          chunk.forEach((d) => {
            batch.delete(doc(db, colName, d.id));
          });
          await batch.commit();
        }
      }
      setShowConfirmDelete(false);
      setIsDeleting(false);
      alert('Global terminal purge complete. All manifests have been wiped.');
    } catch (error) {
      console.error("Scale deletion failed:", error);
      setIsDeleting(false);
      alert('Purge failed. Database locked or quota exceeded.');
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 pb-32">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs md:text-sm font-semibold uppercase tracking-wider text-white">System Configuration</h2>
          <p className="text-[9px] md:text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Global Administrator Controls</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-2 space-y-6">
          <div className="theme-card p-4 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 mb-8 md:mb-10">
              <div className="relative w-fit">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-16 h-16 md:w-20 md:h-20 rounded-2xl border-2 border-white/10 shadow-xl" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-white/5 flex items-center justify-center border-2 border-white/10">
                    <span className="text-xl md:text-2xl font-bold">{user.displayName?.[0] || user.email?.[0]}</span>
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 md:-bottom-2 md:-right-2 w-5 h-5 md:w-6 md:h-6 bg-emerald-500 border-4 border-[#16161a] rounded-full"></div>
              </div>
              <div className="flex-1">
                <p className="text-lg md:text-xl font-bold text-white tracking-tight">{user.displayName || 'Operations Lead'}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Shield size={12} className={isGuest ? "text-emerald-400" : "text-blue-400"} />
                  <p className={cn(
                    "text-[9px] md:text-[10px] uppercase font-bold tracking-widest",
                    isGuest ? "text-emerald-400" : "text-blue-400"
                  )}>
                    {isGuest ? 'Guest Access • Read Only' : 'Master Admin • Level 5 Access'}
                  </p>
                </div>
                <p className="text-[10px] md:text-xs text-slate-500 mt-2 font-mono truncate max-w-[250px]">{user.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 border-t border-white/5 pt-8">
              <div className="space-y-2 md:space-y-3">
                <label className="text-[9px] md:text-[10px] text-slate-500 uppercase font-black tracking-[0.2em]">Regional Assignment</label>
                <div className="p-3 md:p-4 bg-[#111114] border border-white/5 rounded-xl text-[11px] md:text-xs text-slate-300 font-medium font-mono">
                  PHASE-05-DRILL-OPS
                </div>
              </div>
              <div className="space-y-2 md:space-y-3">
                <label className="text-[9px] md:text-[10px] text-slate-500 uppercase font-black tracking-[0.2em]">Terminal Link</label>
                <div className="p-3 md:p-4 bg-[#111114] border border-white/5 rounded-xl text-[11px] md:text-xs text-slate-500 font-mono truncate">
                  8A-{Math.random().toString(36).substring(7).toUpperCase()}-SECURE
                </div>
              </div>
            </div>
          </div>

          {/* Theme Selector */}
          <div className="theme-card p-4 md:p-8">
            <div className="flex items-center gap-2 mb-6">
              <Palette size={16} className="text-blue-400" />
              <h3 className="text-[10px] md:text-xs font-bold text-white uppercase tracking-widest">Interface Skin Selector</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
              {themes.map((t) => (
                    <button 
                      key={t.id}
                      onClick={() => setCurrentTheme(t.id)}
                      className={cn(
                        "p-3 md:p-4 rounded-xl border transition-all text-left group relative overflow-hidden",
                        currentTheme === t.id 
                          ? "bg-blue-500/5 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.1)]" 
                          : "border-theme-border hover:border-slate-500/30"
                      )}
                      style={{ backgroundColor: 'var(--theme-card)' }}
                    >
                      {currentTheme === t.id && (
                        <motion.div 
                          layoutId="theme-active"
                          className="absolute inset-0 bg-blue-500/5 pointer-events-none"
                        />
                      )}
                      <div className="flex gap-1 mb-2 md:mb-3 relative z-10">
                        {t.colors.map((c, i) => (
                          <div key={i} className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full border border-white/10" style={{ backgroundColor: c }}></div>
                        ))}
                      </div>
                      <p className={cn(
                        "text-[9px] md:text-[10px] font-bold uppercase transition-colors relative z-10 truncate",
                        currentTheme === t.id ? "text-blue-500" : "text-slate-500 group-hover:text-slate-300"
                      )}>
                        {t.name}
                      </p>
                    </button>
              ))}
            </div>
          </div>

          {/* Collaborators List */}
          <div className="theme-container overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <UserCheck size={16} className="text-emerald-400" />
                <h3 className="text-[10px] md:text-xs font-bold text-white uppercase tracking-widest">Authorized Personnel</h3>
              </div>
              <span className="text-[8px] md:text-[10px] text-slate-500 font-mono italic">ACTIVE_INVITES: {collaborators.length}</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
              {collaborators.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-[10px] text-slate-600 font-mono uppercase tracking-widest italic">No external authorizations detected</p>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {collaborators.map((c) => (
                    <div key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group bg-white/[0.01] hover:bg-white/[0.03] transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center shrink-0">
                           <Mail size={14} className="text-slate-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-200 uppercase truncate">{c.email}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={cn(
                              "text-[8px] font-black uppercase px-1 rounded-sm",
                              c.role === 'admin' ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"
                            )}>
                              {c.role}
                            </span>
                            <span className="text-[8px] text-slate-600 uppercase font-mono tracking-tighter">By {c.invitedBy?.split('@')[0]}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="flex items-center gap-1.5 text-[8px] text-slate-500 uppercase font-bold">
                          <Clock size={10} />
                          {c.status === 'pending' ? 'Pending Signal' : 'Active'}
                        </div>
                        {!isGuest && (
                          <button 
                            onClick={() => removeCollaborator(c.id)}
                            className="p-1 px-2 border border-white/10 rounded hover:border-rose-500/30 hover:text-rose-500 transition-all text-[9px] font-black uppercase tracking-tighter"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Sidebar */}
        <div className="space-y-6">
          {/* Invite Section */}
          <div className="theme-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus size={16} className="text-emerald-400" />
              <h3 className="text-[10px] md:text-xs font-bold text-white uppercase tracking-widest">Invite Personnel</h3>
            </div>
    <form onSubmit={handleInvite} className="space-y-4 relative">
      {isGuest && (
        <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-[2px] rounded-lg flex flex-col items-center justify-center text-center p-4">
          <Lock className="text-slate-500 mb-2" size={20} />
          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">Administrative Access Required</p>
          <p className="text-[8px] text-slate-500 uppercase mt-1">Guests cannot authorize new accounts</p>
        </div>
      )}
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={14} />
        <input 
          type="email" 
          required
          placeholder="EMAIL..." 
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          className="w-full bg-[#111114] border border-white/5 pl-9 pr-4 py-3 text-[10px] font-mono text-white placeholder:text-slate-700 focus:outline-none focus:border-emerald-500/30 rounded-lg"
        />
      </div>
      
      <div className="space-y-2">
        <label className="text-[9px] text-slate-500 uppercase font-black px-1">Access Level</label>
        <div className="flex gap-2 p-1 bg-black/20 rounded-xl border border-white/5">
          <button 
            type="button" 
            onClick={(e) => { e.preventDefault(); setAccessLevel('admin'); }}
            className={cn(
              "flex-1 py-3 rounded-lg text-[9px] font-bold uppercase transition-all",
              accessLevel === 'admin' 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20" 
                : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
            )}
          >
            Terminal Admin
          </button>
          <button 
            type="button" 
            onClick={(e) => { e.preventDefault(); setAccessLevel('guest'); }}
            className={cn(
              "flex-1 py-3 rounded-lg text-[9px] font-bold uppercase transition-all",
              accessLevel === 'guest' 
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20" 
                : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
            )}
          >
            Guest View
          </button>
        </div>
      </div>

      <button 
        type="submit" 
        disabled={isInviting}
        className="w-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 py-3 rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-2 mt-2"
      >
                {isInviting ? 'Sending Signal...' : inviteSuccess ? `Access Granted (${accessLevel.toUpperCase()})` : 'Authorize Entry'}
                {inviteSuccess && <CheckCircle2 size={12} />}
              </button>
              <p className="text-[8px] text-slate-600 uppercase italic text-center mt-2 px-2">
                * Authorization Signal is logged in dispatch. User link must be shared via secure channel.
              </p>
            </form>
          </div>

          {/* Danger Zone */}
          <div className="theme-container border-rose-500/20 bg-rose-500/[0.02] p-6 relative overflow-hidden">
            {isGuest && (
              <div className="absolute inset-0 z-10 bg-rose-950/40 backdrop-blur-[1px] flex flex-col items-center justify-center text-center p-4">
                <Shield className="text-slate-400 mb-2" size={20} />
                <p className="text-[10px] text-slate-300 font-black uppercase tracking-tighter">Security Lock Active</p>
              </div>
            )}
            <div className="flex items-center gap-2 mb-4">
              <Trash2 size={16} className="text-rose-500" />
              <h3 className="text-xs font-bold text-rose-500 uppercase tracking-widest">Terminal Purge</h3>
            </div>
            <p className="text-[10px] text-slate-500 uppercase font-medium leading-relaxed mb-6">
              Critical operation: Wiping all manifests, personnel records, and flight logs from the secure database.
            </p>
            {!showConfirmDelete ? (
              <button 
                onClick={() => setShowConfirmDelete(true)}
                className="w-full py-3 border border-rose-500/30 text-rose-500 text-[10px] font-bold uppercase tracking-[0.2em] rounded-lg hover:bg-rose-500/10 transition-all"
              >
                Initiate Wipe
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[9px] text-rose-400 font-bold uppercase mb-2">ARE YOU ABSOLUTELY SURE?</p>
                <div className="flex gap-2">
                  <button 
                    onClick={handleDeleteAll}
                    disabled={isDeleting}
                    className="flex-1 bg-rose-500 text-white py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-rose-900/40"
                  >
                    {isDeleting ? 'PURGING...' : 'YES, PURGE ALL'}
                  </button>
                  <button 
                    onClick={() => setShowConfirmDelete(false)}
                    className="px-4 border border-white/10 text-slate-500 text-[10px] font-bold uppercase rounded-lg"
                  >
                    ABORT
                  </button>
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={onLogout}
            className="w-full py-4 bg-[#111114] border border-white/10 text-slate-500 text-[11px] font-bold uppercase tracking-[0.2em] rounded-xl hover:text-white transition-all flex items-center justify-center gap-3"
          >
            Terminal Logout
          </button>
        </div>
      </div>
    </div>
  );
}

