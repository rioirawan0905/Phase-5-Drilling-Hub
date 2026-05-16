import React from 'react';
import { User } from 'firebase/auth';
import { LayoutDashboard, Users, Plane, LogOut, Database, User as UserIcon, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface LayoutProps {
  children: React.ReactNode;
  user: User;
  isGuest?: boolean;
  activeTab: 'dashboard' | 'personnel' | 'flights' | 'settings';
  onTabChange: (tab: 'dashboard' | 'personnel' | 'flights' | 'settings') => void;
  onLogout: () => void;
}

export function Layout({ children, user, isGuest, activeTab, onTabChange, onLogout }: LayoutProps) {
  const navItems = ([
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'personnel', label: 'Drilling Crews', icon: Users },
    { id: 'flights', label: 'Ticketing', icon: Plane },
    !isGuest && { id: 'settings', label: 'Settings', icon: Settings },
  ] as const).filter(Boolean) as { id: 'dashboard' | 'personnel' | 'flights' | 'settings', label: string, icon: any }[];

  return (
    <div className="h-screen flex flex-col overflow-hidden font-sans transition-colors duration-400" style={{ height: '100dvh', backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)' }}>
      {/* Header */}
      <header className="h-20 border-b flex items-center justify-between px-6 md:px-10 shrink-0 z-30 transition-all duration-400" style={{ backgroundColor: 'var(--theme-header)', borderBottomColor: 'var(--theme-border)' }}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-white shadow-2xl shadow-blue-500/30 shrink-0" style={{ backgroundColor: 'var(--theme-accent)' }}>
            P5
          </div>
          <div className="overflow-hidden">
            <h1 className="text-sm md:text-base font-extrabold tracking-tighter uppercase text-[var(--theme-text)] leading-none truncate">PHASE 5 <span className="text-blue-600">DRILLING HUB</span></h1>
            <p className="text-[9px] md:text-[10px] text-[var(--theme-text-muted)] font-extrabold uppercase tracking-[0.2em] mt-1.5 truncate">Unified Personnel Control</p>
          </div>
        </div>

        <div className="flex items-center gap-4 md:gap-10">
          <nav className="hidden lg:flex gap-8 items-center text-[11px] font-extrabold uppercase tracking-[0.15em]">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "transition-all flex items-center gap-2.5 relative py-2 group",
                  activeTab === item.id ? "text-blue-600" : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                )}
              >
                <item.icon size={16} className={cn("transition-colors", activeTab === item.id ? "text-blue-600" : "text-[var(--theme-text-muted)] group-hover:text-[var(--theme-text)]")} />
                <span>{item.label}</span>
                {activeTab === item.id && (
                  <motion.div 
                    layoutId="activeTab"
                    className="absolute -bottom-[25px] left-0 right-0 h-[3px] bg-blue-600 rounded-t-full"
                  />
                )}
              </button>
            ))}
          </nav>
          
          <div className="hidden lg:block h-8 w-[1px] mx-2" style={{ backgroundColor: 'var(--theme-border)' }}></div>
          
          <div className="flex items-center gap-3 md:gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-[11px] font-black leading-none text-[var(--theme-text)] truncate max-w-[80px] md:max-w-none uppercase tracking-wide">{isGuest ? 'Guest' : (user.displayName?.split(' ')[0] || 'Staff')}</p>
              <p className="text-[9px] text-[var(--theme-text-muted)] font-extrabold uppercase tracking-widest mt-1.5">{isGuest ? 'Read Only' : 'Administrator'}</p>
            </div>
            <div className="relative shrink-0">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-9 h-9 md:w-10 md:h-10 rounded-2xl border-2 border-white shadow-xl shadow-[var(--theme-shadow)] object-cover" />
              ) : (
                <div className="w-9 h-9 md:w-10 md:h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm">
                  <UserIcon size={18} />
                </div>
              )}
            </div>
            <button 
              onClick={onLogout}
              className="text-[var(--theme-text-muted)] hover:text-red-500 transition-all p-2 hover:bg-red-50 rounded-xl"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Subheader / Status Bar */}
        <div className="h-10 border-b px-6 md:px-10 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] shrink-0" style={{ backgroundColor: 'var(--theme-status)', borderBottomColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}>
          <div className="flex gap-6">
            <span className="hidden sm:inline">Node: Central-01</span>
            <span className="text-blue-600">Segment: {activeTab}</span>
          </div>
          <div className="flex gap-6 items-center">
            <span className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div> 
              <span className="hidden xs:inline">System Link: Stable</span>
            </span>
          </div>
        </div>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar" style={{ backgroundColor: 'var(--theme-bg)' }}>
          <div className="max-w-[1600px] mx-auto min-h-full">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden h-18 sm:h-20 border-t flex items-center justify-around px-2 sm:px-4 shrink-0 z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]" style={{ backgroundColor: 'var(--theme-header)', borderTopColor: 'var(--theme-border)' }}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={cn(
              "flex flex-col items-center gap-1.5 w-full py-2 transition-all rounded-2xl",
              activeTab === item.id ? "text-blue-600 bg-blue-50/50" : "text-[var(--theme-text-muted)]"
            )}
          >
            <item.icon size={20} className={cn(activeTab === item.id ? "scale-110" : "")} />
            <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest truncate w-full text-center px-1">
              {item.id === 'personnel' ? 'Crews' : 
               item.id === 'flights' ? 'Flights' : 
               item.label}
            </span>
          </button>
        ))}
      </nav>

      {/* Footer Status Bar - Only on Desktop */}
      <footer className="hidden md:flex h-10 border-t px-10 items-center justify-between text-[9px] font-black uppercase tracking-[0.25em] shrink-0" style={{ backgroundColor: 'var(--theme-header)', borderTopColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}>
        <div className="flex gap-8">
          <span>UTC: {new Date().toLocaleTimeString('en-US', { hour12: false })}</span>
          <span className="hidden lg:inline">COORDS: 58.96N / 5.73E</span>
          <span className="hidden lg:inline">ENC: AES-GCM</span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="text-[var(--theme-border)] tracking-normal font-mono font-bold opacity-30">P5.OS v2.0 // PRODUCTION NODE</span>
        </div>
      </footer>
    </div>
  );
}
