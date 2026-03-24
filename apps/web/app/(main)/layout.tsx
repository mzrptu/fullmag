'use client';

import type { ReactNode } from 'react';
import { AppLayout } from '../../components/layout';

export default function MainLayout({ children }: { children: ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
