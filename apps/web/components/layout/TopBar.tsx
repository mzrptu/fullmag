'use client';

import { type ReactNode } from 'react';
import { ThemeToggle } from '../theme';

interface TopBarProps {
  breadcrumb?: { label: string; href?: string }[];
  onMobileMenuToggle: () => void;
  actions?: ReactNode;
}

export function TopBar({ breadcrumb, onMobileMenuToggle, actions }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="topbar-mobile-toggle"
          onClick={onMobileMenuToggle}
          aria-label="Toggle navigation"
        >
          <MenuIcon />
        </button>

        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
            {breadcrumb.map((item, i) => (
              <span key={i}>
                {i > 0 && (
                  <span className="topbar-breadcrumb-separator">/</span>
                )}
                {i === breadcrumb.length - 1 ? (
                  <span className="topbar-breadcrumb-current">
                    {item.label}
                  </span>
                ) : (
                  <span>{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
      </div>

      <div className="topbar-right">
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
