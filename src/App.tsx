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

    // Initialize Theme
    const savedTheme = localStorage.getItem('app-theme') || 'bright-modern';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
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
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center font-sans text-[#0F172A]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-100 border-t-[var(--theme-accent)] rounded-full animate-spin"></div>
          <p className="text-slate-400 uppercase tracking-[0.2em] text-[10px] font-black">Initializing Operations...</p>
        </div>
      </div>
    );
  }

  if (!user && !isGuest) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex flex-col lg:flex-row font-sans text-[#0F172A] overflow-hidden selection:bg-blue-100">
        {/* Left Side: Brand & Live Intel */}
        <div className="hidden lg:flex w-1/2 relative bg-[#F8FAFC] border-r border-[#E2E8F0] flex-col p-12 overflow-hidden">
          {/* Animated Grid */}
          <div 
            className="absolute inset-0 opacity-[0.05]"
            style={{ 
              backgroundImage: `linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)`,
              backgroundSize: '40px 40px'
            }}
          ></div>
          
          {/* Subtle Glows */}
          <div className="absolute top-1/4 -left-20 w-96 h-96 bg-blue-400/5 blur-[120px] rounded-full"></div>
          <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-emerald-400/5 blur-[120px] rounded-full"></div>

          <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center gap-3 mb-16">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/20" style={{ backgroundColor: 'var(--theme-accent)' }}>
                <Plane className="text-white" size={24} />
              </div>
              <span className="text-xl font-black uppercase tracking-tighter italic">PHASE 5 <span style={{ color: 'var(--theme-accent)' }}>DRILLING HUB</span></span>
            </div>

            <div className="mt-auto">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8 }}
              >
                <h1 className="text-8xl font-extrabold uppercase tracking-tighter leading-[0.85] mb-6 text-[#0F172A]">
                  PHASE 5 <br /> <span style={{ color: 'var(--theme-accent)' }}>DRILLING HUB</span>
                </h1>
                <p className="text-slate-400 text-base max-w-md uppercase tracking-wider font-extrabold leading-relaxed mb-12">
                  Precision Logistics & Personnel Control <br /> Unified Intelligence Management
                </p>
              </motion.div>

              {/* Status Ticker Card */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="bg-white border border-[#E2E8F0] shadow-2xl shadow-blue-900/5 rounded-[2rem] p-8 max-w-sm"
              >
                <div className="flex items-center justify-between mb-8">
                   <div className="flex items-center gap-3">
                      <Activity size={16} className="text-emerald-500" />
                      <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Hub Status</span>
                   </div>
                   <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      <span className="text-[9px] text-emerald-600 font-black uppercase tracking-widest">Active</span>
                   </div>
                </div>
                
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest">Main Clock</span>
                    <span className="text-xl font-mono text-[#0F172A] font-black tracking-tighter">{currentTime || '00:00:00'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest">System Load</span>
                    <span className="text-[11px] font-mono font-black" style={{ color: 'var(--theme-accent)' }}>OPTIMIZED // 0.04%</span>
                  </div>
                </div>
              </motion.div>
            </div>
            
            <div className="mt-16 text-[10px] text-slate-300 font-bold flex gap-8 uppercase tracking-[0.2em]">
              <span>© 2024 P5D</span>
              <span>Encrypted</span>
              <span>Proprietary</span>
            </div>
          </div>
        </div>

        {/* Right Side: Auth Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-24 relative bg-white">
          <div className="lg:hidden absolute top-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4">
             <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/20 mb-2">
                <Plane className="text-white" size={28} />
             </div>
             <h1 className="text-2xl font-black uppercase tracking-tighter text-[#0F172A]">Phase 5 <span className="text-lg" style={{ color: 'var(--theme-accent)' }}>Drilling</span></h1>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-sm"
          >
            <div className="mb-14 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 border border-blue-100 rounded-full mb-6">
                <Lock size={12} className="text-blue-600" />
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--theme-accent)' }}>Secured Gateway</span>
              </div>
              <h2 className="text-4xl font-extrabold text-[#0F172A] uppercase tracking-tighter mb-4">Command Center</h2>
              <p className="text-slate-500 text-sm uppercase font-bold tracking-wider leading-relaxed">
                Personnel deployment, scheduling, and logistics monitoring dashboard
              </p>
            </div>

            <div className="space-y-4">
              <button 
                onClick={handleGuestEntry}
                className="w-full h-16 bg-white border-2 border-[#E2E8F0] text-slate-500 hover:text-[#0F172A] hover:border-slate-300 transition-all rounded-2xl flex items-center justify-center gap-4 text-[11px] font-black uppercase tracking-widest"
              >
                <Users size={20} />
                <span>Guest Protocol</span>
              </button>

              <button 
                onClick={handleLogin}
                disabled={isLoggingIn}
                className={cn(
                  "w-full h-16 hover:brightness-110 text-white font-black uppercase tracking-widest text-[13px] rounded-2xl flex items-center justify-center gap-4 transition-all shadow-2xl shadow-blue-500/20 group relative overflow-hidden",
                  isLoggingIn && "opacity-50 cursor-not-allowed"
                )}
                style={{ backgroundColor: 'var(--theme-accent)' }}
              >
                <Globe size={20} />
                <span>{isLoggingIn ? 'Authorizing...' : 'Admin Authorization'}</span>
                <ChevronRight size={16} className="opacity-60" />
              </button>
            </div>

            <div className="mt-14 space-y-6">
               <div className="flex items-center gap-4 text-slate-200">
                  <div className="h-[2px] flex-1 bg-slate-100"></div>
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Certification</span>
                  <div className="h-[2px] flex-1 bg-slate-100"></div>
               </div>
               
               <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex flex-col items-center gap-2">
                     <Shield size={14} className="text-blue-600" />
                     <span className="text-[8px] text-slate-400 font-black uppercase">AES-256</span>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex flex-col items-center gap-2">
                     <Clock size={14} className="text-blue-600" />
                     <span className="text-[8px] text-slate-400 font-black uppercase">OAUTH-2</span>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex flex-col items-center gap-2">
                     <Globe size={14} className="text-blue-600" />
                     <span className="text-[8px] text-slate-400 font-black uppercase">CLOUD</span>
                  </div>
               </div>
            </div>

            <div className="mt-12 pt-8 border-t border-slate-100 text-center lg:text-left">
              <p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.1em] leading-relaxed">
                Emergency logistics failure? Contact hub operations <br /> manager or bypass via terminal admin override.
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
