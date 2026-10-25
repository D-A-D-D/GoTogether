import { escapeHtml, passwordResetEmail, tokenLink, verificationEmail } from './email-templates.js';

describe('tokenLink', () => {
  it('puts the token in the fragment, which browsers never send to a server', () => {
    const link = tokenLink('https://app.example.com', '/reset-password', 'abc_DEF-123');
    expect(link).toBe('https://app.example.com/reset-password#token=abc_DEF-123');
    expect(new URL(link).search).toBe('');
    expect(new URL(link).hash).toBe('#token=abc_DEF-123');
  });

  it('copes with a trailing slash on the origin', () => {
    expect(tokenLink('https://app.example.com/', '/verify-email', 't')).toBe('https://app.example.com/verify-email#token=t');
  });

  it('escapes anything that is not URL-safe', () => {
    expect(tokenLink('https://a.example', '/x', 'a b&c')).toBe('https://a.example/x#token=a%20b%26c');
  });
});

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  });
});

describe('passwordResetEmail', () => {
  const email = passwordResetEmail({ to: 'una@example.com', name: 'Una', link: 'https://app.example.com/reset-password#token=SECRET' });

  it('goes to the account address, with a plain subject', () => {
    expect(email.to).toBe('una@example.com');
    expect(email.subject).toBe('Reset your GoTogether password');
  });

  it('never puts the token in the subject', () => {
    expect(email.subject).not.toContain('SECRET');
  });

  it('has the link in both the plain and the HTML version', () => {
    expect(email.text).toContain('https://app.example.com/reset-password#token=SECRET');
    expect(email.html).toContain('https://app.example.com/reset-password#token=SECRET');
  });

  it('says it expires, works once, and what to do if it was not them', () => {
    expect(email.text).toMatch(/once/);
    expect(email.text).toMatch(/1 hour/);
    expect(email.text).toMatch(/not you/i);
  });

  it('cannot be used to inject markup through someone\'s name', () => {
    const evil = passwordResetEmail({ to: 'a@example.com', name: '<img src=x onerror=alert(1)>', link: 'https://x.example/y#token=t' });
    expect(evil.html).not.toContain('<img src=x');
    expect(evil.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('verificationEmail', () => {
  const email = verificationEmail({ to: 'una@example.com', name: 'Una', link: 'https://app.example.com/verify-email#token=SECRET' });

  it('has its own subject and the link', () => {
    expect(email.subject).toBe('Confirm your GoTogether email address');
    expect(email.text).toContain('/verify-email#token=SECRET');
    expect(email.html).toContain('/verify-email#token=SECRET');
  });

  it('says it expires in a day and what to do if the person did not sign up', () => {
    expect(email.text).toMatch(/24 hours/);
    expect(email.text).toMatch(/did not create an account/i);
  });
});
