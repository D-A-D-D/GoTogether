'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, getMe, getTags, updateMe, type Tag } from '@/lib/api';
import { queryCache, useQuery } from '@/lib/query';
import { Label, TextInput, TextArea, ErrorText, PrimaryButton } from '@/components/form-controls';
import { Avatar, Button, Card, Chip, Skeleton } from '@/components/ui';
import { IconCheck, IconLogout, IconShield } from '@/components/icons';
import { AccountSettings } from './account-settings';
import { EmailVerification } from './email-verification';
import { BlockedPeople } from './blocked-people';
import { PushSettings } from './push-settings';
import { TrustHistory } from './trust-history';

const CATEGORY_LABELS: Record<Tag['category'], string> = {
  STYLE: 'Trip style',
  IDENTITY: 'Identity & community',
  DIETARY: 'Dietary',
  SAFETY: 'Safety',
};

export default function ProfilePage() {
  const status = useRequireAuth();
  const { refreshUser, logout } = useAuth();
  const router = useRouter();
  const signedIn = status === 'authenticated';

  const meQuery = useQuery('me', getMe, { enabled: signedIn, staleMs: 15_000 });
  const tagsQuery = useQuery('tags', getTags, { enabled: signedIn, staleMs: 600_000 });
  const profile = meQuery.data;
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [homeRegion, setHomeRegion] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // The form takes its starting values from the profile once, when it first arrives; after that
  // it is the person's own typing that counts, not whatever the background refresh brings.
  const seeded = useRef(false);
  useEffect(() => {
    if (!profile || seeded.current) return;
    seeded.current = true;
    // Deferred a microtask so setState never happens synchronously within the effect body.
    void Promise.resolve().then(() => {
      setName(profile.name);
      setBio(profile.bio ?? '');
      setHomeCity(profile.homeCity ?? '');
      setHomeRegion(profile.homeRegion ?? '');
      setSelectedTagIds(new Set((profile.preferenceTags ?? []).map((t) => t.id)));
    });
  }, [profile]);

  const tagsByCategory = useMemo(() => {
    const groups = new Map<Tag['category'], Tag[]>();
    for (const tag of tags) {
      const group = groups.get(tag.category) ?? [];
      group.push(tag);
      groups.set(tag.category, group);
    }
    return groups;
  }, [tags]);

  function toggleTag(id: string) {
    setSaved(false);
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updateMe({
        name,
        bio,
        homeCity,
        homeRegion,
        preferenceTagIds: [...selectedTagIds],
      });
      queryCache.set('me', updated);
      // Matches depend on these tags, so the discovery lists are out of date now.
      queryCache.invalidate('discover:');
      await refreshUser();
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save changes — try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  if (!signedIn && status !== 'loading') return null;

  if (meQuery.error && !profile) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <ErrorText>Could not load your profile — try refreshing.</ErrorText>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 pt-5" aria-busy="true" aria-label="Loading your profile">
        <div className="flex items-center gap-4">
          <Skeleton className="h-20 w-20 !rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        </div>
        <Skeleton className="mt-6 h-64 w-full !rounded-2xl" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-5">
      <h1 className="sr-only">Your profile</h1>
      <EmailVerification />

      <section className="flex items-center gap-4" aria-label="You">
        <Avatar name={profile.name} size={84} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-2xl font-bold leading-tight">{profile.name}</p>
          <p className="truncate text-muted">{profile.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip tone="gold" className="font-bold">
              <IconShield size={16} />
              Trust {Math.round(profile.trustScore)}
            </Chip>
            {/* What has actually been confirmed, not the name of the account's tier. */}
            {profile.emailVerifiedAt && <Chip>Email confirmed</Chip>}
            {profile.verificationTier === 'PHONE' && <Chip>Phone verified</Chip>}
            {profile.verificationTier === 'ID' && <Chip>ID verified</Chip>}
          </div>
        </div>
      </section>

      <Card className="mt-6 flex flex-col gap-5 p-5">
        <h2 className="text-xl font-bold">About you</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <TextInput id="name" value={name} onChange={(e) => (setSaved(false), setName(e.target.value))} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bio">Bio</Label>
          <TextArea
            id="bio"
            rows={3}
            maxLength={500}
            placeholder="A couple of lines about how you like to travel."
            value={bio}
            onChange={(e) => (setSaved(false), setBio(e.target.value))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="homeCity">Home city</Label>
            <TextInput id="homeCity" value={homeCity} onChange={(e) => (setSaved(false), setHomeCity(e.target.value))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="homeRegion">Region / country</Label>
            <TextInput id="homeRegion" value={homeRegion} onChange={(e) => (setSaved(false), setHomeRegion(e.target.value))} />
          </div>
        </div>
      </Card>

      <Card className="mt-5 flex flex-col gap-5 p-5">
        <div>
          <h2 className="text-xl font-bold">How you travel</h2>
          <p className="mt-1 text-muted">These help hosts and the matching find trips that fit you.</p>
        </div>
        {[...tagsByCategory.entries()].map(([category, categoryTags]) => (
          <div key={category}>
            <p className="mb-2 text-[0.95rem] font-semibold text-muted">{CATEGORY_LABELS[category]}</p>
            <div className="flex flex-wrap gap-2">
              {categoryTags.map((tag) => {
                const active = selectedTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    aria-pressed={active}
                    className={`pressable inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 text-base font-medium transition ${
                      active ? 'border-accent bg-accent text-on-accent' : 'border-field text-foreground hover:border-accent'
                    }`}
                  >
                    {active && <IconCheck size={18} />}
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </Card>

      <div className="mt-5">
        <ErrorText>{saveError}</ErrorText>
        <div className="flex items-center gap-4">
          <PrimaryButton type="button" onClick={handleSave} disabled={saving} className="w-fit">
            {saving ? 'Saving…' : 'Save changes'}
          </PrimaryButton>
          {saved && (
            <p role="status" className="inline-flex items-center gap-1.5 font-semibold text-accent">
              <IconCheck size={20} />
              Saved
            </p>
          )}
        </div>
      </div>

      <PushSettings />
      <BlockedPeople />
      <TrustHistory />
      <AccountSettings />

      <div className="mt-10 border-t border-line pt-6">
        <Button variant="secondary" onClick={handleLogout}>
          <IconLogout size={20} />
          Log out
        </Button>
      </div>
    </main>
  );
}
