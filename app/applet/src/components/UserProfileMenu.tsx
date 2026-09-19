import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, User as UserIcon, ChevronDown, Key } from 'lucide-react';

interface UserProfileMenuProps {
  userLabel: string;
  userCode: string;
  onLogout: () => void;
}

export const UserProfileMenu: React.FC<UserProfileMenuProps> = ({
  userLabel,
  userCode,
  onLogout,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger Button */}
      <button
        type="button"
        id="user-profile-button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 transition-all shadow-2xs group focus:outline-none focus:ring-2 focus:ring-slate-300 cursor-pointer"
      >
        <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-black text-xs">
          {userLabel ? userLabel.charAt(0).toUpperCase() : 'U'}
        </div>
        <div className="flex flex-col text-left">
          <span className="text-xs font-bold text-slate-900 leading-tight">
            {userLabel || 'User'}
          </span>
          <span className="text-[10px] font-mono text-slate-400 font-bold">{userCode}</span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200" />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-60 bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 p-2 z-50 text-left"
          >
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-1.5">
              <p className="text-xs font-bold text-slate-900">{userLabel}</p>
              <div className="flex items-center gap-1 mt-1 text-[11px] font-mono font-bold text-slate-500">
                <Key className="w-3 h-3 text-slate-400" />
                <span>Kode: {userCode}</span>
              </div>
            </div>

            <button
              type="button"
              id="logout-button"
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
