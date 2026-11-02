import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Premier Express Business Manager', description: 'Premier Express Tourism LLC — business operations and AI management workspace' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
