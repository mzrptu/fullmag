'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Footer } from './Footer';
import { navigationItems } from './navigation';

interface AppLayoutProps {
  children: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  actions?: ReactNode;
}

export function AppLayout({ children, breadcrumb, actions }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleMobile = useCallback(() => {
    setMobileOpen((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  return (
    <div className="app-layout" data-collapsed={collapsed}>
      <Sidebar
        items={navigationItems}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />
      <TopBar
        breadcrumb={breadcrumb}
        onMobileMenuToggle={toggleMobile}
        actions={actions}
      />
      <main className="main-content">
        <div className="main-content-inner">{children}</div>
      </main>
      <Footer />
    </div>
  );
}
