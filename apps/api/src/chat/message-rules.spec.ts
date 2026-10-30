import { messageProblem, notificationBody, storedContent, MAX_CAPTION_LENGTH, MAX_TEXT_LENGTH } from './message-rules.js';

describe('messageProblem', () => {
  it('accepts ordinary text, and refuses empty or blank text', () => {
    expect(messageProblem('TEXT', 'hello', undefined)).toBeNull();
    expect(messageProblem('TEXT', '', undefined)).toMatch(/empty/);
    expect(messageProblem('TEXT', '   \n  ', undefined)).toMatch(/empty/);
  });

  it('refuses text longer than the limit, but accepts exactly the limit', () => {
    expect(messageProblem('TEXT', 'x'.repeat(MAX_TEXT_LENGTH), undefined)).toBeNull();
    expect(messageProblem('TEXT', 'x'.repeat(MAX_TEXT_LENGTH + 1), undefined)).toMatch(/at most/);
  });

  it('does not let a text message carry a file', () => {
    expect(messageProblem('TEXT', 'hi', 'media-1')).toMatch(/cannot carry a file/);
  });

  it('needs the uploaded file for a picture or a voice note', () => {
    expect(messageProblem('IMAGE', '', undefined)).toMatch(/picture/);
    expect(messageProblem('VOICE', '', undefined)).toMatch(/voice/i);
    expect(messageProblem('IMAGE', '', 'media-1')).toBeNull();
    expect(messageProblem('VOICE', '', 'media-1')).toBeNull();
  });

  it('allows a picture a caption, up to the limit', () => {
    expect(messageProblem('IMAGE', 'sunrise at the fort', 'media-1')).toBeNull();
    expect(messageProblem('IMAGE', 'x'.repeat(MAX_CAPTION_LENGTH), 'media-1')).toBeNull();
    expect(messageProblem('IMAGE', 'x'.repeat(MAX_CAPTION_LENGTH + 1), 'media-1')).toMatch(/caption/);
  });
});

describe('storedContent', () => {
  it('trims text and captions', () => {
    expect(storedContent('TEXT', '  hello  ')).toBe('hello');
    expect(storedContent('IMAGE', '  nice  ')).toBe('nice');
  });

  it('stores nothing for a voice note, whatever was sent with it', () => {
    expect(storedContent('VOICE', 'ignore me')).toBe('');
  });
});

describe('notificationBody', () => {
  it('shows text as it is, cut at 80 characters', () => {
    expect(notificationBody('TEXT', 'hello')).toBe('hello');
    expect(notificationBody('TEXT', 'x'.repeat(80))).toBe('x'.repeat(80));
    expect(notificationBody('TEXT', 'x'.repeat(81))).toBe(`${'x'.repeat(80)}…`);
  });

  it('says what kind of thing a picture or voice note is, not nothing', () => {
    expect(notificationBody('IMAGE', '')).toBe('📷 Photo');
    expect(notificationBody('IMAGE', '  ')).toBe('📷 Photo');
    expect(notificationBody('IMAGE', 'the view')).toBe('📷 the view');
    expect(notificationBody('VOICE', 'anything')).toBe('🎤 Voice message');
  });

  it('cuts a long caption too', () => {
    expect(notificationBody('IMAGE', 'y'.repeat(200))).toBe(`📷 ${'y'.repeat(80)}…`);
  });
});
