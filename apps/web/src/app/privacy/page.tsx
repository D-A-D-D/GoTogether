import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Privacy Policy — GoTogether' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="[date]">
      <p>
        GoTogether helps people find travel companions and plan trips together. This explains what we collect, why, who
        else handles it, and what you can do about it. Questions: [support email address].
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> email address, name, and a password (stored only as a one-way hash; we cannot
          read it). If you sign in with Google, we receive your name and email from Google.
        </li>
        <li>
          <strong>Your profile:</strong> anything you choose to add — a short bio, your home city and region, and the
          travel preferences you pick.
        </li>
        <li>
          <strong>What you do in the app:</strong> trips you host, requests to join, messages in trip chats, expenses
          you add or share in, reviews you write, the trust score that results, and reports and blocks you make.
        </li>
        <li>
          <strong>Notifications:</strong> if you turn them on, an address your browser gives us for sending you
          notifications on that device.
        </li>
        <li>
          <strong>Technical records:</strong> our servers log each request — the page requested, the time, the result
          and your network (IP) address — to keep the service running and to investigate abuse. We do not log
          passwords, cookies or message contents there.
        </li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To run the service: sign you in, show trips, let you chat and split costs.</li>
        <li>To keep people safe: trust scores, reports, blocking, and human review of reports.</li>
        <li>To email you about your account: verifying your address, resetting a password, and similar.</li>
        <li>To protect the service from abuse, such as repeated failed sign-ins.</li>
      </ul>
      <p>We do not sell your data, and we do not show advertising.</p>

      <h2>Who else handles it</h2>
      <p>We use outside services to run GoTogether, and they process data on our behalf:</p>
      <ul>
        <li>Database hosting: Neon, in Singapore.</li>
        <li>Application hosting: [hosting providers].</li>
        <li>Email sending: Resend.</li>
        <li>Browser notification delivery: the push service built into your browser (Google, Mozilla or Apple).</li>
      </ul>

      <h2>Who can see what</h2>
      <p>
        Other members can see your name, bio, home city, trust score and reviews about you once they are revealed. Your
        messages and expenses are visible to the people on the trip. Your email address is not shown to other members.
      </p>

      <h2>Cookies and storage</h2>
      <p>
        We use one cookie, which keeps you signed in; it is needed for the service to work, so we do not ask for consent
        for it. Your browser also stores a small note of whether you turned on notifications on that device. We use no
        advertising or tracking cookies.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>See your data:</strong> Profile → Your data → download a copy.
        </li>
        <li>
          <strong>Delete your account:</strong> Profile → Delete my account. Your profile, sign-in, notifications,
          blocks and trust history are erased. Messages you sent, expenses you shared and reviews you wrote stay on
          other people&apos;s trips, shown as &ldquo;Deleted user&rdquo;, because they are part of other people&apos;s
          records and are needed to settle up. They are no longer linked to your name or email.
        </li>
        <li>
          <strong>Correct or ask about your data:</strong> edit your profile in the app, or write to [support email
          address].
        </li>
      </ul>

      <h2>How long we keep things</h2>
      <p>
        We keep your data while your account exists. After deletion, the records described above remain, anonymised, for
        as long as the trip they belong to. Server logs are kept for [number] days. [Dispute-retention period, if any.]
      </p>

      <h2>Children</h2>
      <p>GoTogether is for people aged 18 and over.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell you in the app before it takes effect.</p>

      <h2>Contact</h2>
      <p>[Company or operator name and address]. [Support email address].</p>
    </LegalPage>
  );
}
