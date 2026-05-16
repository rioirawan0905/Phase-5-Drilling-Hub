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
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('app-theme') || 'corporate');
  const [collaborators, setCollaborators] = useState<any[]>([]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
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
    { id: 'corporate', name: 'Corporate Blue', colors: ['#f8fafc', '#ffffff', '#1e3a8a'], light: true },
    { id: 'bright-modern', name: 'Bright Modern', colors: ['#f8fafc', '#ffffff', '#2563eb'], light: true },
    { id: 'dark-pro', name: 'Dark Pro', colors: ['#0a0a0c', '#111114', '#3b82f6'] },
    { id: 'high-contrast', name: 'High Contrast', colors: ['#000000', '#111111', '#ffffff'] },
    { id: 'cyberpunk', name: 'Cyberpunk', colors: ['#050505', '#1a0033', '#ff00ff'] },
    { id: 'minimalist', name: 'Minimalist', colors: ['#ffffff', '#f8fafc', '#000000'], light: true },
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
          <h2 className="text-xs md:text-sm font-extrabold uppercase tracking-wider text-[#0F172A]">System Configuration</h2>
          <p className="text-[9px] md:text-[10px] text-slate-400 font-extrabold uppercase tracking-widest mt-0.5">Global Administrator Controls</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-2 space-y-6">
          <div className="theme-card p-4 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 mb-8 md:mb-10">
              <div className="relative w-fit">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-16 h-16 md:w-20 md:h-20 rounded-[1.5rem] border-2 border-slate-100 shadow-xl" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-[1.5rem] bg-slate-50 flex items-center justify-center border-2 border-slate-100 text-slate-400 shadow-inner">
                    <span className="text-xl md:text-2xl font-black">{user.displayName?.[0] || user.email?.[0]}</span>
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 md:-bottom-2 md:-right-2 w-5 h-5 md:w-6 md:h-6 bg-emerald-500 border-4 border-white rounded-full shadow-lg shadow-emerald-500/20"></div>
              </div>
              <div className="flex-1">
                <p className="text-lg md:text-xl font-black text-[#0F172A] tracking-tighter uppercase">{user.displayName || 'Operations Lead'}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Shield size={12} className={isGuest ? "text-emerald-500" : "text-blue-600"} />
                  <p className={cn(
                    "text-[9px] md:text-[10px] uppercase font-black tracking-widest",
                    isGuest ? "text-emerald-500" : "text-blue-600"
                  )}>
                    {isGuest ? 'Guest Access • Read Only' : 'Master Admin • Level 5 Access'}
                  </p>
                </div>
                <p className="text-[10px] md:text-xs text-slate-400 mt-2 font-mono truncate max-w-[250px] font-bold">{user.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 border-t border-slate-50 pt-8">
              <div className="space-y-2 md:space-y-3">
                <label className="text-[9px] md:text-[10px] text-slate-400 uppercase font-black tracking-[0.2em]">Regional Assignment</label>
                <div className="p-3 md:p-4 bg-slate-50 border border-slate-100 rounded-xl text-[11px] md:text-xs text-[#0F172A] font-black font-mono">
                  PHASE-05-DRILL-OPS
                </div>
              </div>
              <div className="space-y-2 md:space-y-3">
                <label className="text-[9px] md:text-[10px] text-slate-400 uppercase font-black tracking-[0.2em]">Terminal Link</label>
                <div className="p-3 md:p-4 bg-slate-50 border border-slate-100 rounded-xl text-[11px] md:text-xs text-slate-400 font-mono truncate font-bold">
                  8A-{Math.random().toString(36).substring(7).toUpperCase()}-SECURE
                </div>
              </div>
            </div>
          </div>

          {/* Theme Selector */}
          <div className="theme-card p-4 md:p-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shadow-inner">
                <Palette size={16} />
              </div>
              <h3 className="text-[11px] md:text-xs font-black text-black uppercase tracking-[0.2em]">Interface Skin Selector</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
              {themes.map((t) => (
                    <button 
                      key={t.id}
                      onClick={() => setCurrentTheme(t.id)}
                      className={cn(
                        "p-4 md:p-6 rounded-[1.5rem] border-2 transition-all text-left group relative overflow-hidden",
                        currentTheme === t.id 
                          ? "bg-blue-50/50 border-blue-500 shadow-[0_20px_40px_rgba(59,130,246,0.1)]" 
                          : "border-slate-50 bg-slate-50/50 hover:border-slate-200 hover:bg-white"
                      )}
                    >
                      <div className="flex gap-1.5 mb-4 relative z-10">
                        {t.colors.map((c, i) => (
                          <div key={i} className="w-3 h-3 md:w-4 md:h-4 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: c }}></div>
                        ))}
                      </div>
                      <p className={cn(
                        "text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-colors relative z-10 truncate leading-tight",
                        currentTheme === t.id ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
                      )}>
                        {t.name}
                      </p>
                    </button>
              ))}
            </div>
          </div>

          {/* Collaborators List */}
          <div className="theme-container overflow-hidden bg-white border-slate-100">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-inner">
                  <UserCheck size={16} />
                </div>
                <h3 className="text-[10px] md:text-xs font-black text-[#0F172A] uppercase tracking-[0.2em]">Authorized Personnel</h3>
              </div>
              <span className="text-[8px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest">ACTIVE_INVITES: {collaborators.length}</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
              {collaborators.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-[10px] text-slate-600 font-mono uppercase tracking-widest italic">No external authorizations detected</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {collaborators.map((c) => (
                    <div key={c.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 shadow-inner">
                           <Mail size={16} className="text-slate-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12px] font-black text-[#0F172A] uppercase tracking-tight truncate">{c.email}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className={cn(
                              "text-[8px] font-black uppercase px-2 py-0.5 rounded-full border",
                              c.role === 'admin' ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                            )}>
                              {c.role}
                            </span>
                            <span className="text-[9px] text-slate-400 uppercase font-black tracking-widest">By {c.invitedBy?.split('@')[0]}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-5 shrink-0">
                        <div className="flex items-center gap-2 text-[9px] text-slate-400 uppercase font-black tracking-widest bg-slate-100 px-3 py-1.5 rounded-full shadow-inner">
                          <Clock size={11} className="text-slate-400" />
                          {c.status === 'pending' ? 'Pending Signal' : 'Active'}
                        </div>
                        {!isGuest && (
                          <button 
                            onClick={() => removeCollaborator(c.id)}
                            className="p-2 px-4 border border-slate-100 bg-white rounded-xl shadow-sm hover:border-rose-200 hover:text-rose-500 transition-all text-[9px] font-black uppercase tracking-widest"
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
          <div className="theme-card p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-inner">
                <UserPlus size={16} />
              </div>
              <h3 className="text-[11px] md:text-xs font-black text-[#0F172A] uppercase tracking-[0.2em]">Invite Personnel</h3>
            </div>
    <form onSubmit={handleInvite} className="space-y-5 relative">
      {isGuest && (
        <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center text-center p-4">
          <Lock className="text-slate-400 mb-2" size={20} />
          <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest leading-relaxed">Administrative <br/>Access Required</p>
          <p className="text-[8px] text-slate-400 uppercase mt-2 font-bold tracking-widest">Read-only mode active</p>
        </div>
      )}
      <div className="relative">
        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input 
          type="email" 
          required
          placeholder="EMAIL@PHASE5.COM" 
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          className="w-full bg-slate-50 border border-slate-100 pl-11 pr-4 py-3.5 text-[10px] font-mono font-black text-[#0F172A] placeholder:text-slate-300 focus:outline-none focus:border-emerald-500/30 rounded-xl transition-all"
        />
      </div>
      
      <div className="space-y-3">
        <label className="text-[9px] text-slate-400 uppercase font-black px-1 tracking-widest">Access Level</label>
        <div className="flex flex-col gap-2 p-1.5 bg-slate-50 rounded-2xl border border-slate-100">
          <button 
            type="button" 
            onClick={(e) => { e.preventDefault(); setAccessLevel('admin'); }}
            className={cn(
              "w-full py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all",
              accessLevel === 'admin' 
                ? "bg-white text-blue-600 shadow-sm border border-slate-100" 
                : "text-slate-400 hover:text-slate-600 hover:bg-white/50"
            )}
          >
            Terminal Admin
          </button>
          <button 
            type="button" 
            onClick={(e) => { e.preventDefault(); setAccessLevel('guest'); }}
            className={cn(
              "w-full py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all",
              accessLevel === 'guest' 
                ? "bg-white text-emerald-600 shadow-sm border border-slate-100" 
                : "text-slate-400 hover:text-slate-600 hover:bg-white/50"
            )}
          >
            Guest View
          </button>
        </div>
      </div>

      <button 
        type="submit" 
        disabled={isInviting}
        className="w-full bg-emerald-600 text-white py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:opacity-90 transition-all flex items-center justify-center gap-3 mt-4 shadow-xl shadow-emerald-900/10"
      >
                {isInviting ? 'Sending Signal...' : inviteSuccess ? `Access Granted` : 'Authorize Entry'}
                {inviteSuccess && <CheckCircle2 size={12} />}
              </button>
              <p className="text-[8px] text-slate-400 uppercase font-bold text-center mt-4 px-4 leading-relaxed tracking-widest">
                * Signal is logged. User link must be shared via secure channel.
              </p>
            </form>
          </div>

          {/* Danger Zone */}
          <div className="theme-container border-rose-100 bg-rose-50/30 p-8 relative overflow-hidden">
            {isGuest && (
              <div className="absolute inset-0 z-10 bg-rose-50/40 backdrop-blur-[1px] flex flex-col items-center justify-center text-center p-4">
                <Shield className="text-rose-300 mb-2" size={20} />
                <p className="text-[10px] text-rose-400 font-extrabold uppercase tracking-widest">Security Lock Active</p>
              </div>
            )}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-rose-600 shadow-inner">
                <Trash2 size={16} />
              </div>
              <h3 className="text-[11px] font-black text-rose-600 uppercase tracking-[0.2em]">Terminal Purge</h3>
            </div>
            <p className="text-[9px] text-slate-400 uppercase font-black leading-relaxed mb-6 tracking-widest">
              Critical operation: Wiping all manifests, personnel records, and flight logs from the secure database.
            </p>
            {!showConfirmDelete ? (
              <button 
                onClick={() => setShowConfirmDelete(true)}
                className="w-full py-4 border-2 border-rose-200 text-rose-600 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-rose-100 transition-all shadow-sm"
              >
                Initiate Wipe
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-[9px] text-rose-600 font-black uppercase mb-2 tracking-widest text-center">ARE YOU ABSOLUTELY SURE?</p>
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={handleDeleteAll}
                    disabled={isDeleting}
                    className="w-full bg-rose-600 text-white py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-rose-900/20"
                  >
                    {isDeleting ? 'PURGING...' : 'YES, PURGE ALL'}
                  </button>
                  <button 
                    onClick={() => setShowConfirmDelete(false)}
                    className="w-full py-3 bg-white border border-slate-100 text-slate-400 text-[10px] font-black uppercase rounded-xl tracking-widest shadow-sm"
                  >
                    ABORT
                  </button>
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={onLogout}
            className="w-full py-5 bg-white border-2 border-slate-100 text-[#0F172A] text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:border-slate-200 hover:bg-slate-50 transition-all flex items-center justify-center gap-4 shadow-xl shadow-blue-900/5 group"
          >
            <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-white transition-colors">
              <Lock size={12} className="text-slate-400" />
            </div>
            Terminal Logout
          </button>
        </div>
      </div>
    </div>
  );
}

