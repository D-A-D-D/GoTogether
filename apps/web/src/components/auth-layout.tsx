import type { ReactNode } from 'react';
import { TripCover } from '@/components/ui';
import { LogoMark } from '@/components/icons';

/**
 * The frame for sign-in, sign-up and the other account screens. On a wide screen a panel of
 * the app's own dusk-and-contour artwork stands beside the form; on a phone it is just the form.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1">
      <aside className="relative hidden w-[45%] max-w-xl lg:block" aria-hidden="true">
        <TripCover seed="gotogether" className="absolute inset-0">
          <div className="absolute inset-0 flex flex-col justify-end gap-3 p-10">
            <LogoMark size={44} className="text-white/90" />
            <p className="font-display text-4xl font-bold leading-[1.1]">Find the people who travel the way you do.</p>
            <p className="max-w-sm text-lg text-white/85">
              Match on pace, budget and style. Read their record before you pack. Split the costs without the awkwardness.
            </p>
          </div>
        </TripCover>
      </aside>
      <section className="flex flex-1 flex-col justify-center px-6 py-10 sm:py-14">
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
