import React from 'react';
import { User } from 'firebase/auth';
import { LayoutDashboard, Users, Plane, LogOut, Database, User as UserIcon, Settings } from 'lucide-react';
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
    { id: 'personnel', label: 'Crew Roster', icon: Users },
    { id: 'flights', label: 'Ticketing', icon: Plane },
    !isGuest && { id: 'settings', label: 'Settings', icon: Settings },
  ] as const).filter(Boolean) as { id: 'dashboard' | 'personnel' | 'flights' | 'settings', label: string, icon: any }[];

  return (
    <div className="h-screen flex flex-col overflow-hidden font-sans transition-colors duration-300" style={{ height: '100dvh', backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)' }}>
      {/* Header */}
      <header className="h-16 border-b flex items-center justify-between px-4 md:px-6 shrink-0 z-30 transition-colors duration-300" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-header)' }}>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="w-7 h-7 md:w-8 md:h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white shadow-lg shadow-blue-900/20 shrink-0">
            P5
          </div>
          <div className="overflow-hidden">
            <h1 className="text-[11px] md:text-sm font-bold tracking-tight uppercase text-white leading-none truncate">Phase 5 Drilling</h1>
            <p className="text-[8px] md:text-[10px] text-slate-500 uppercase tracking-widest mt-0.5 truncate">Personnel & Flight Control</p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-6">
          <nav className="hidden md:flex gap-6 items-center text-[11px] font-medium uppercase tracking-wider">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "transition-colors flex items-center gap-2",
                  activeTab === item.id ? "text-blue-400" : "text-slate-500 hover:text-white"
                )}
              >
                <item.icon size={14} className={cn("transition-colors", activeTab === item.id ? "text-blue-400" : "text-slate-500")} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          
          <div className="hidden md:block h-8 w-[1px] bg-white/10 mx-2"></div>
          
          <div className="flex items-center gap-2 md:gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold leading-none text-white truncate max-w-[80px] md:max-w-none">{isGuest ? 'Guest' : (user.displayName?.split(' ')[0] || 'Staff')}</p>
              <p className="text-[9px] md:text-[10px] text-slate-500 uppercase tracking-tighter truncate">{isGuest ? 'Read Only' : 'Admin'}</p>
            </div>
            <div className="relative group shrink-0">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-6 h-6 md:w-8 md:h-8 rounded-full border border-white/10" />
              ) : (
                <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center">
                  <UserIcon size={12} className="text-slate-400" />
                </div>
              )}
            </div>
            <button 
              onClick={onLogout}
              className="text-slate-500 hover:text-red-400 transition-colors p-1"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Subheader / Status Bar */}
        <div className="h-7 md:h-8 border-b px-4 md:px-6 flex items-center justify-between text-[8px] md:text-[9px] uppercase tracking-[0.2em] shrink-0 transition-colors duration-300" style={{ backgroundColor: 'var(--theme-status)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}>
          <div className="flex gap-4">
            <span className="hidden sm:inline">Terminal: 05-ALPHA</span>
            <span style={{ color: 'var(--theme-text)' }}>SEC: {activeTab}</span>
          </div>
          <div className="flex gap-4 items-center">
            <span className="flex items-center gap-1">
              <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></div> 
              <span className="hidden xs:inline">Link Active</span>
            </span>
          </div>
        </div>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar transition-colors duration-300" style={{ backgroundColor: 'var(--theme-bg)' }}>
          <div className="max-w-[1400px] mx-auto min-h-full">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden h-16 border-t flex items-center justify-around px-2 shrink-0 z-30 transition-colors duration-300" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-header)' }}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={cn(
              "flex flex-col items-center gap-1 w-full py-1 transition-all rounded-lg",
              activeTab === item.id ? "text-blue-400 bg-blue-500/5" : "text-slate-500"
            )}
          >
            <item.icon size={18} />
            <span className="text-[8px] font-black uppercase tracking-tighter">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer Status Bar - Only on Desktop */}
      <footer className="hidden md:flex h-8 border-t px-6 items-center justify-between text-[9px] uppercase tracking-[0.2em] shrink-0 transition-colors duration-300" style={{ backgroundColor: 'var(--theme-header)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}>
        <div className="flex gap-6">
          <span>System Time: {new Date().toLocaleTimeString('en-US', { hour12: false })} UTC</span>
          <span>LAT: 58.9690° N</span>
          <span>LONG: 5.7331° E</span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="text-slate-400 tracking-normal font-mono uppercase">v5.1.0 Phase 5 Production Build</span>
        </div>
      </footer>
    </div>
  );
}
