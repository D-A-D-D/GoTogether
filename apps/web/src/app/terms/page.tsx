import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Terms of Use — GoTogether' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="[date]">
      <p>
        By creating an account or using GoTogether you agree to these terms and to our{' '}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        . If you don&apos;t agree, please don&apos;t use the service.
      </p>

      <h2>What GoTogether is — and isn&apos;t</h2>
      <p>
        GoTogether is a way to find people to travel with and to organise a trip with them. We are not a travel agent,
        tour operator or transport provider, we do not run or insure trips, and we are not a party to any arrangement
        between members. <strong>Trips are organised by members, and you join them at your own risk.</strong> Use your
        own judgement: meet in public first, tell someone where you are going, and never feel pressured to go ahead.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be 18 or over, and give accurate information.</li>
        <li>You are responsible for your password and for what happens under your account.</li>
        <li>One person, one account.</li>
      </ul>

      <h2>How to behave</h2>
      <p>You agree not to:</p>
      <ul>
        <li>harass, threaten, discriminate against or deceive other members;</li>
        <li>post anything unlawful, or that you don&apos;t have the right to share;</li>
        <li>pretend to be someone else, or write false or retaliatory reviews or reports;</li>
        <li>try to get round limits, probe or attack the service, or collect other members&apos; data;</li>
        <li>use GoTogether to sell things or to recruit for anything other than a trip.</li>
      </ul>

      <h2>Money</h2>
      <p>
        The expense feature is a shared notebook of who owes whom. GoTogether does not hold, move or guarantee money, and
        is not responsible if someone does not pay. Settle up between yourselves.
      </p>

      <h2>Reviews, trust scores and reports</h2>
      <p>
        Members can review each other after a trip, and reviews feed a trust score. Members can report each other; a
        person on our team looks at reports and may warn, suspend or close an account, and records why. These decisions
        are made in good faith on the information we have. [How to appeal.]
      </p>

      <h2>Your content</h2>
      <p>
        You keep ownership of what you post. You give us permission to store it and show it to the people it is meant for
        so that the service works. If you delete your account, the rules in the Privacy Policy apply to what remains.
      </p>

      <h2>Ending things</h2>
      <p>
        You can delete your account at any time from your profile. We may suspend or close an account that breaks these
        terms or puts others at risk.
      </p>

      <h2>No guarantees; limits on our responsibility</h2>
      <p>
        The service is provided as it is, and may have interruptions or errors. To the extent the law allows, we are not
        liable for what happens on or because of a trip, for what other members say or do, or for losses that arise
        indirectly from using the service. Nothing here limits any right you have that the law does not allow to be
        limited. [Liability limit, to be set with legal advice.]
      </p>

      <h2>Changes and law</h2>
      <p>
        We may update these terms; if the change matters we will tell you in the app first. These terms are governed by
        the laws of [India / state], and disputes go to the courts of [city], unless the law gives you another right.
      </p>

      <h2>Contact</h2>
      <p>[Company or operator name and address]. [Support email address].</p>
    </LegalPage>
  );
}
