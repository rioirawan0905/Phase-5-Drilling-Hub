import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { PersonnelList } from './components/PersonnelList';
import { FlightsList } from './components/FlightsList';
import { Settings } from './components/Settings';
import { ChevronRight, LogIn, Plane, Users, LayoutDashboard, Database, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'personnel' | 'flights' | 'settings'>('dashboard');

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
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-6 font-sans relative overflow-hidden text-white">
        {/* Background Decorative Gradients */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/5 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/5 blur-[120px] rounded-full"></div>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm relative z-10"
        >
          <div className="bg-[#111114] border border-white/10 p-10 rounded-2xl shadow-2xl">
            <div className="flex justify-center mb-8">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Plane className="text-white" size={24} />
              </div>
            </div>
            
            <div className="text-center mb-10">
              <h1 className="text-2xl font-bold text-white uppercase tracking-tight mb-2">Phase 5 Logistics</h1>
              <p className="text-[11px] text-slate-500 uppercase tracking-widest leading-relaxed">
                Integrated Personnel & Flight <br /> Terminal Access Portal
              </p>
            </div>

            <div className="space-y-3">
              <button 
                onClick={handleLogin}
                disabled={isLoggingIn}
                className={cn(
                  "w-full btn-primary h-12 flex items-center justify-center gap-3 group",
                  isLoggingIn && "opacity-50 cursor-not-allowed"
                )}
              >
                <Shield size={18} className="group-hover:translate-x-0.5 transition-transform" />
                <span>{isLoggingIn ? 'Authenticating...' : 'Administrator Authentication'}</span>
              </button>

              <button 
                onClick={handleGuestEntry}
                className="w-full h-12 bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all rounded-xl flex items-center justify-center gap-3 text-sm font-bold uppercase tracking-widest"
              >
                <Users size={18} />
                <span>Continue as Guest</span>
              </button>
            </div>

            <div className="mt-10 pt-8 border-t border-white/5 text-center">
              <p className="text-[9px] text-slate-600 uppercase tracking-[0.3em]">
                Secure Entry Point / Authorization Required
              </p>
            </div>
          </div>
        </motion.div>
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
