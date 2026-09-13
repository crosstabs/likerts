import Link from 'next/link';
import type { Metadata } from 'next';
import { FeedbackSession } from '../components/session';
import './styles.css';

export const metadata: Metadata = { title: 'Likerts · Next.js feedback example', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><FeedbackSession><header><Link href="/">Fieldnotes</Link><nav><Link href="/">Checkout</Link><Link href="/away">Continue browsing</Link></nav></header><main>{children}</main><footer>Local developer example · fictional order · temporary storage</footer></FeedbackSession></body></html>;
}
