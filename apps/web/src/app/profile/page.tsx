'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, getMe, getTags, updateMe, type PublicUser, type Tag } from '@/lib/api';
import { Label, TextInput, TextArea, ErrorText, PrimaryButton } from '@/components/form-controls';
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
  const { refreshUser } = useAuth();

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [homeRegion, setHomeRegion] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    Promise.all([getMe(), getTags()])
      .then(([me, allTags]) => {
        setProfile(me);
        setTags(allTags);
        setName(me.name);
        setBio(me.bio ?? '');
        setHomeCity(me.homeCity ?? '');
        setHomeRegion(me.homeRegion ?? '');
        setSelectedTagIds(new Set((me.preferenceTags ?? []).map((t) => t.id)));
      })
      .catch(() => setLoadError('Could not load your profile — try refreshing.'));
  }, [status]);

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
      setProfile(updated);
      await refreshUser();
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save changes — try again.');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading' || (status === 'authenticated' && !profile && !loadError)) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-foreground/60">Loading your profile…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <ErrorText>{loadError}</ErrorText>
      </main>
    );
  }

  if (!profile) return null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <EmailVerification />
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <div className="text-right">
          <div className="font-mono text-2xl font-semibold text-accent">{profile.trustScore}</div>
          <div className="text-xs uppercase tracking-wide text-foreground/50">Trust score</div>
        </div>
      </div>
      <p className="mt-1 text-sm text-foreground/60">
        {profile.email} &middot; {profile.verificationTier.toLowerCase()} verified
      </p>

      <div className="mt-8 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <TextInput id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bio">Bio</Label>
          <TextArea
            id="bio"
            rows={3}
            maxLength={500}
            placeholder="A couple of lines about how you like to travel."
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="homeCity">Home city</Label>
            <TextInput id="homeCity" value={homeCity} onChange={(e) => setHomeCity(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="homeRegion">Region / country</Label>
            <TextInput id="homeRegion" value={homeRegion} onChange={(e) => setHomeRegion(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Travel &amp; lifestyle tags</Label>
          <p className="mt-0.5 text-xs text-foreground/50">
            These help hosts and the matching engine find trips that fit you.
          </p>
          <div className="mt-3 flex flex-col gap-4">
            {[...tagsByCategory.entries()].map(([category, categoryTags]) => (
              <div key={category}>
                <div className="mb-1.5 font-mono text-xs uppercase tracking-wide text-foreground/50">
                  {CATEGORY_LABELS[category]}
                </div>
                <div className="flex flex-wrap gap-2">
                  {categoryTags.map((tag) => {
                    const active = selectedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        aria-pressed={active}
                        className={`rounded-full border px-3 py-1 text-sm transition ${
                          active
                            ? 'border-accent bg-accent text-background'
                            : 'border-line text-foreground/70 hover:border-accent/50'
                        }`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <ErrorText>{saveError}</ErrorText>
        {saved && <p className="text-sm text-accent">Saved.</p>}

        <PrimaryButton type="button" onClick={handleSave} disabled={saving} className="w-fit px-6">
          {saving ? 'Saving…' : 'Save changes'}
        </PrimaryButton>
      </div>

      <PushSettings />
      <BlockedPeople />
      <TrustHistory />
      <AccountSettings />
    </main>
  );
}
