import { Avatar, ButtonLink, Chip, TripCover } from '@/components/ui';
import { IconCalendar, IconShield, IconUsers, IconWallet } from '@/components/icons';

/** The public front page. Sample trips here are illustrations, not listings. */

const SAMPLES = [
  { place: 'Spiti Valley', days: '10 days', budget: '₹18,000 – ₹25,000', seats: '6 seats', tilt: '-rotate-6 left-0 top-10 z-10', tags: ['slow pace', 'homestays'] },
  { place: 'Hampi', days: '6 days', budget: '₹9,000 – ₹14,000', seats: '5 seats', tilt: 'rotate-3 right-0 top-0 z-20', tags: ['cycling', 'budget'] },
  { place: 'Munnar', days: '7 days', budget: '₹14,000 – ₹20,000', seats: '4 seats', tilt: '-rotate-2 left-10 top-52 z-30 sm:left-16', tags: ['tea hills', 'vegetarian'] },
];

const STEPS = [
  {
    n: '01',
    title: 'Say how you travel',
    body: 'Slow mornings or sunrise treks, hostels or homestays, vegetarian or not. Trips are matched on how you actually like to go, not on who you already know.',
  },
  {
    n: '02',
    title: 'Meet people who fit',
    body: 'Hosts post a trip with dates, a budget and a few honest tags. You see how well it matches you, the host’s record, and who is already going.',
  },
  {
    n: '03',
    title: 'Go, and settle up fairly',
    body: 'A group chat for the trip, a shared ledger for who paid what, and reviews afterwards that feed everyone’s trust score.',
  },
];

function SampleCard({ place, days, budget, seats, tilt, tags }: (typeof SAMPLES)[number]) {
  return (
    <div className={`absolute w-60 overflow-hidden rounded-3xl border border-line bg-surface shadow-card sm:w-72 ${tilt}`} aria-hidden="true">
      <TripCover seed={place} className="aspect-[16/9]">
        <p className="absolute bottom-3 left-4 font-display text-2xl font-bold drop-shadow">{place}</p>
      </TripCover>
      <div className="flex flex-col gap-2 p-3.5 text-[0.9rem]">
        <div className="flex items-center gap-1.5 text-muted">
          <IconCalendar size={16} /> {days}
          <span className="mx-1">·</span>
          <IconUsers size={16} /> {seats}
        </div>
        <div className="flex items-center gap-1.5 font-semibold">
          <IconWallet size={16} /> {budget}
        </div>
        <div className="flex gap-1.5">
          {tags.map((t) => (
            <Chip key={t} className="!px-2.5 !py-0.5 !text-[0.8rem]">
              {t}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <main className="flex-1">
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-12 pt-8 sm:pt-14 lg:grid-cols-2 lg:gap-6">
        <div>
          <Chip tone="gold">Travel companions, matched</Chip>
          <h1 className="mt-5 font-display text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">
            Find the people who make the trip.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
            Hill stations, beaches, treks, temple towns. GoTogether matches you with travellers who want the same kind of trip
            &mdash; then gives the group a chat, a shared ledger and a trust record to lean on.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/register" size="lg">
              Get started
            </ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary">
              Log in
            </ButtonLink>
          </div>
          <p className="mt-4 text-[0.95rem] text-muted">Free to use. Works in your browser; add it to your home screen like an app.</p>
        </div>

        <div className="relative mx-auto h-[33rem] w-full max-w-sm sm:h-[36rem] sm:max-w-md" role="img" aria-label="Three sample trips: Spiti Valley, Hampi and Munnar">
          {SAMPLES.map((s) => (
            <SampleCard key={s.place} {...s} />
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-5 py-14">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">How it works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n}>
                <span className="font-display text-5xl font-extrabold text-accent-ink/70">{step.n}</span>
                <h3 className="mt-2 text-xl font-bold">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 py-14 md:grid-cols-2">
        <div>
          <h2 className="font-display text-3xl font-bold sm:text-4xl">A reputation you can read</h2>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-muted">
            Everyone starts at 50. It moves as people finish trips and are reviewed by the ones who went. Reviews stay hidden until
            both sides have written theirs, so nobody writes to please.
          </p>
        </div>
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[
            ['Isha K.', 74, 'Finished 5 trips'],
            ['Aarav M.', 61, 'Finished 2 trips'],
            ['You', 50, 'Just starting'],
          ].map(([name, score, note]) => (
            <div key={name as string} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
              <Avatar name={name as string} size={46} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{name}</p>
                <p className="text-[0.9rem] text-muted">{note}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 font-bold">
                <IconShield size={18} className="text-accent-ink" />
                {score}
              </span>
            </div>
          ))}
          <p className="text-[0.85rem] text-muted">Example profiles, for illustration.</p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16">
        <div className="rounded-[2rem] bg-forest px-6 py-12 text-center text-on-forest sm:px-12">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Your next trip is better with the right people.</h2>
          <p className="mx-auto mt-3 max-w-xl text-lg text-on-forest/80">Make an account in a minute and see what is open.</p>
          <ButtonLink href="/register" size="lg" className="mt-7 !bg-gold !text-on-gold">
            Create your account
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
