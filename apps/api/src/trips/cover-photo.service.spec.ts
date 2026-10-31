import { CoverPhotoService, acceptedPhotoUrl, coverSearchTerms } from './cover-photo.service.js';

const THUMB = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Shillong.jpg/320px-Shillong.jpg';

describe('coverSearchTerms', () => {
  it('starts with the place as typed, then each part of it', () => {
    expect(coverSearchTerms('Munnar and Alleppey, Kerala')).toEqual(['Munnar and Alleppey, Kerala', 'Munnar', 'Alleppey', 'Kerala']);
    expect(coverSearchTerms('  Spiti,   Himachal Pradesh ')).toEqual(['Spiti, Himachal Pradesh', 'Spiti', 'Himachal Pradesh']);
  });

  it('keeps a single place as one term, and ignores tiny fragments', () => {
    expect(coverSearchTerms('Goa')).toEqual(['Goa']);
    expect(coverSearchTerms('Hampi, KA')).toEqual(['Hampi, KA', 'Hampi']);
  });

  it('never asks for more than four terms', () => {
    expect(coverSearchTerms('Aaa, Bbb, Ccc, Ddd, Eee, Fff')).toHaveLength(4);
  });
});

describe('acceptedPhotoUrl', () => {
  it("accepts Wikimedia's own host and asks for a wider thumbnail", () => {
    expect(acceptedPhotoUrl(THUMB)).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Shillong.jpg/960px-Shillong.jpg');
    expect(acceptedPhotoUrl('//upload.wikimedia.org/x/y.jpg')).toBe('https://upload.wikimedia.org/x/y.jpg');
    expect(acceptedPhotoUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ac/E.jpg/330px-E.jpg?utm_source=en.wikipedia.org')).toContain('/960px-E.jpg');
  });

  it('refuses any other host, plain http, look-alike hosts and things that are not addresses', () => {
    for (const bad of ['https://evil.example/a.jpg', 'http://upload.wikimedia.org/a.jpg', 'https://upload.wikimedia.org.evil.example/a.jpg', 'https://evil.example/?https://upload.wikimedia.org/a.jpg', 'javascript:alert(1)', 'not a url', '', null, undefined, 5]) {
      expect(acceptedPhotoUrl(bad)).toBeNull();
    }
  });
});

describe('CoverPhotoService.find', () => {
  function serviceWith(routes: Record<string, unknown>) {
    const service = new CoverPhotoService();
    const asked: string[] = [];
    service.fetcher = async (url) => {
      asked.push(url);
      const hit = Object.entries(routes).find(([fragment]) => url.includes(fragment));
      return { ok: !!hit, json: async () => hit?.[1] };
    };
    return { service, asked };
  }

  it('uses the first article that has a picture', async () => {
    const { service, asked } = serviceWith({ 'summary/Shillong': { type: 'standard', thumbnail: { source: THUMB } } });
    expect(await service.find('Shillong')).toContain('/960px-Shillong.jpg');
    expect(asked).toHaveLength(1);
  });

  it('moves on from an article with no picture to the next part of the place', async () => {
    const { service } = serviceWith({
      'summary/Spiti%2C%20Himachal%20Pradesh': { type: 'standard' },
      'summary/Spiti?': { type: 'standard', thumbnail: { source: THUMB } },
    });
    expect(await service.find('Spiti, Himachal Pradesh')).not.toBeNull();
  });

  it('skips a "may refer to" page', async () => {
    const { service } = serviceWith({ 'summary/Mercury': { type: 'disambiguation', thumbnail: { source: THUMB } } });
    expect(await service.find('Mercury')).toBeNull();
  });

  it('falls back to a search using the trip name when the place itself has nothing', async () => {
    const { service, asked } = serviceWith({
      'search/title': { pages: [{ key: 'Living_root_bridges' }] },
      'summary/Living_root_bridges': { type: 'standard', thumbnail: { source: THUMB } },
    });
    expect(await service.find('Meghalaya villages', 'living root bridges')).not.toBeNull();
    expect(asked.some((u) => u.includes('search/title') && decodeURIComponent(u).includes('living root bridges'))).toBe(true);
  });

  it('refuses a picture hosted anywhere but Wikimedia', async () => {
    const { service } = serviceWith({ 'summary/Goa': { type: 'standard', thumbnail: { source: 'https://evil.example/goa.jpg' } } });
    expect(await service.find('Goa')).toBeNull();
  });

  it('is null, not an error, when the network fails or times out', async () => {
    const service = new CoverPhotoService();
    service.fetcher = async () => {
      throw new Error('offline');
    };
    expect(await service.find('Goa')).toBeNull();
  });
});
