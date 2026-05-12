import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { PersonnelList } from './components/PersonnelList';
import { FlightsList } from './components/FlightsList';
import { Settings } from './components/Settings';
import { ChevronRight, LogIn, Plane, Users, LayoutDashboard, Database, Shield, Globe, Clock, Activity, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'personnel' | 'flights' | 'settings'>('dashboard');

  // Clock state for landing page
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) setIsGuest(false); // Clear guest mode if logged in
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      if ((error as any).code !== 'auth/cancelled-popup-request') {
        console.error("Login failed:", error);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGuestEntry = () => {
    setIsGuest(true);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsGuest(false);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center font-sans text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="text-slate-500 uppercase tracking-widest text-[10px]">Initializing System...</p>
        </div>
      </div>
    );
  }

  if (!user && !isGuest) {
    return (
      <div className="min-h-screen bg-[#070708] flex flex-col lg:flex-row font-sans text-white overflow-hidden selection:bg-blue-500/30">
        {/* Left Side: Brand & Live Intel */}
        <div className="hidden lg:flex w-1/2 relative bg-[#0a0a0c] border-r border-white/5 flex-col p-12 overflow-hidden">
          {/* Animated Matrix Grid */}
          <div 
            className="absolute inset-0 opacity-[0.03]"
            style={{ 
              backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
              backgroundSize: '40px 40px'
            }}
          ></div>
          
          {/* Subtle Glows */}
          <div className="absolute top-1/4 -left-20 w-96 h-96 bg-blue-600/10 blur-[120px] rounded-full"></div>
          <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-emerald-600/5 blur-[120px] rounded-full"></div>

          <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center gap-3 mb-16">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Plane className="text-white" size={20} />
              </div>
              <span className="text-lg font-black uppercase tracking-tighter italic">Phase 5 <span className="text-blue-500">Drilling</span></span>
            </div>

            <div className="mt-auto">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8 }}
              >
                <h1 className="text-7xl font-black uppercase tracking-tighter leading-[0.9] mb-4">
                  Phase 5 <br /> <span className="text-blue-600">Drilling Hub</span>
                </h1>
                <p className="text-slate-500 text-sm max-w-md uppercase tracking-widest font-bold leading-relaxed mb-12">
                  Unified Personnel Deployment & <br /> Flight Operations Management System
                </p>
              </motion.div>

              {/* Status Ticker Card */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 max-w-sm backdrop-blur-md"
              >
                <div className="flex items-center justify-between mb-6">
                   <div className="flex items-center gap-2">
                      <Activity size={14} className="text-emerald-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Live Status</span>
                   </div>
                   <div className="flex items-center gap-2 px-2 py-1 bg-emerald-500/10 rounded-full">
                      <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></div>
                      <span className="text-[8px] text-emerald-500 font-black uppercase">System Ready</span>
                   </div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-slate-600 font-bold uppercase">Terminal Clock</span>
                    <span className="text-sm font-mono text-white font-black">{currentTime || '00:00:00'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-slate-600 font-bold uppercase">Network Integrity</span>
                    <span className="text-[10px] font-mono text-blue-500 font-bold">STABLE // 9ms</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-slate-600 font-bold uppercase">Access Node</span>
                    <span className="text-[10px] font-mono text-slate-400 uppercase">South Terminal-A</span>
                  </div>
                </div>
              </motion.div>
            </div>
            
            <div className="mt-16 text-[9px] text-slate-700 font-mono flex gap-8 uppercase tracking-widest">
              <span>© 2024 Phase 5 Drilling</span>
              <span>Encrypted Session</span>
              <span>Proprietary Data</span>
            </div>
          </div>
        </div>

        {/* Right Side: Auth Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-24 relative overflow-hidden">
          <div className="lg:hidden absolute top-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4">
             <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 mb-2">
                <Plane className="text-white" size={24} />
             </div>
             <h1 className="text-xl font-black uppercase tracking-tighter">Phase 5 <span className="text-blue-500">Drilling</span></h1>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-sm"
          >
            <div className="mb-12 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full mb-4">
                <Lock size={10} className="text-blue-400" />
                <span className="text-[9px] text-blue-400 font-black uppercase tracking-widest">Secure Authentication</span>
              </div>
              <h2 className="text-3xl font-black text-white uppercase tracking-tight mb-3">Welcome Back</h2>
              <p className="text-slate-500 text-xs uppercase font-bold tracking-wider leading-relaxed">
                Show the dashboard, personnel schedule and flight ticket requests status in one place
              </p>
            </div>

            <div className="space-y-4">
              <button 
                onClick={handleGuestEntry}
                className="w-full h-14 bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all rounded-xl flex items-center justify-center gap-4 text-[10px] font-black uppercase tracking-widest"
              >
                <Users size={18} />
                <span>Access as Guest</span>
              </button>

              <button 
                onClick={handleLogin}
                disabled={isLoggingIn}
                className={cn(
                  "w-full h-14 bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest text-xs rounded-xl flex items-center justify-center gap-4 transition-all shadow-xl shadow-blue-900/20 group relative overflow-hidden",
                  isLoggingIn && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                <Globe size={18} />
                <span>{isLoggingIn ? 'Verifying...' : 'Administrator Authentication'}</span>
                <ChevronRight size={14} className="opacity-50" />
              </button>
            </div>

            <div className="mt-12 space-y-4">
               <div className="flex items-center gap-4 text-slate-700">
                  <div className="h-px flex-1 bg-white/[0.05]"></div>
                  <span className="text-[9px] font-black uppercase tracking-widest">Access Requirements</span>
                  <div className="h-px flex-1 bg-white/[0.05]"></div>
               </div>
               
               <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-white/[0.01] border border-white/5 flex flex-col items-center gap-1">
                     <Shield size={12} className="text-slate-600" />
                     <span className="text-[7px] text-slate-500 font-bold uppercase">Encrypted</span>
                  </div>
                  <div className="p-3 rounded-lg bg-white/[0.01] border border-white/5 flex flex-col items-center gap-1">
                     <Clock size={12} className="text-slate-600" />
                     <span className="text-[7px] text-slate-500 font-bold uppercase">Verified</span>
                  </div>
                  <div className="p-3 rounded-lg bg-white/[0.01] border border-white/5 flex flex-col items-center gap-1">
                     <Globe size={12} className="text-slate-600" />
                     <span className="text-[7px] text-slate-500 font-bold uppercase">Universal</span>
                  </div>
               </div>
            </div>

            <div className="mt-12 pt-8 border-t border-white/5 text-center lg:text-left">
              <p className="text-[8px] text-slate-600 uppercase font-bold tracking-[0.2em] leading-relaxed">
                Emergency logistics contact? Request bypass from terminal <br /> operations manager or contact system support.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <Layout 
      user={user || { displayName: 'Guest User', email: 'guest@phase5.ops', photoURL: null } as any} 
      isGuest={isGuest}
      activeTab={activeTab} 
      onTabChange={setActiveTab}
      onLogout={handleLogout}
    >
      <AnimatePresence mode="wait">
        {activeTab === 'dashboard' && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2 }}
          >
            <Dashboard isGuest={isGuest} />
          </motion.div>
        )}
        {activeTab === 'personnel' && (
          <motion.div
            key="personnel"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2 }}
          >
            <PersonnelList isGuest={isGuest} />
          </motion.div>
        )}
        {activeTab === 'flights' && (
          <motion.div
            key="flights"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2 }}
          >
            <FlightsList isGuest={isGuest} />
          </motion.div>
        )}
        {activeTab === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2 }}
          >
            <Settings user={user || { displayName: 'Guest User', email: 'guest@phase5.ops', photoURL: null } as any} isGuest={isGuest} onLogout={handleLogout} />
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
}
