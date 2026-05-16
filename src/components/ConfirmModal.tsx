import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  type?: 'danger' | 'warning';
}

export function ConfirmModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText = 'Confirm',
  type = 'danger'
}: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            onClick={onClose} 
            className="absolute inset-0 bg-black/90 backdrop-blur-sm" 
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }} 
            animate={{ opacity: 1, scale: 1, y: 0 }} 
            exit={{ opacity: 0, scale: 0.95, y: 20 }} 
            className="relative w-full max-w-sm bg-[var(--theme-card)] border border-[var(--theme-border)] rounded-2xl p-6 shadow-2xl overflow-hidden"
          >
            {/* Warning Banner */}
            <div className={`absolute top-0 left-0 right-0 h-1 ${type === 'danger' ? 'bg-rose-500' : 'bg-amber-500'}`} />
            
            <div className="flex items-start gap-4 mt-2">
              <div className={`p-2 rounded-lg ${type === 'danger' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-[var(--theme-text)] uppercase tracking-wider">{title}</h3>
                <p className="text-[11px] text-[var(--theme-text-muted)] mt-1 leading-relaxed">{message}</p>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button 
                onClick={onClose}
                className="flex-1 px-4 py-2 text-[10px] font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] uppercase tracking-widest border border-[var(--theme-border)] rounded-lg transition-all"
              >
                Abort
              </button>
              <button 
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={`flex-1 px-4 py-2 text-[10px] font-bold text-white uppercase tracking-widest rounded-lg shadow-lg transition-all ${
                  type === 'danger' ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-900/20' : 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/20'
                }`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
