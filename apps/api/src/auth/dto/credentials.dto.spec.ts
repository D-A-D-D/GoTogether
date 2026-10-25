import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto } from './credentials.dto.js';

const TOKEN = 'T'.repeat(43);
const errors = async (cls: new () => object, body: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('ForgotPasswordDto', () => {
  it('needs an email address', async () => {
    expect(await errors(ForgotPasswordDto, { email: 'una@example.com' })).toEqual([]);
    expect(await errors(ForgotPasswordDto, { email: 'not-an-email' })).toEqual(['email']);
    expect(await errors(ForgotPasswordDto, {})).toEqual(['email']);
  });
});

describe('ResetPasswordDto', () => {
  it('accepts a real-looking token and a password of 8 to 72 characters', async () => {
    expect(await errors(ResetPasswordDto, { token: TOKEN, password: 'x'.repeat(8) })).toEqual([]);
    expect(await errors(ResetPasswordDto, { token: TOKEN, password: 'x'.repeat(72) })).toEqual([]);
  });

  it('holds new passwords to the same rules as registration', async () => {
    expect(await errors(ResetPasswordDto, { token: TOKEN, password: 'x'.repeat(7) })).toEqual(['password']);
    expect(await errors(ResetPasswordDto, { token: TOKEN, password: 'x'.repeat(73) })).toEqual(['password']);
  });

  it('refuses a token too short to be real, or absurdly long', async () => {
    expect(await errors(ResetPasswordDto, { token: 'short', password: 'x'.repeat(8) })).toEqual(['token']);
    expect(await errors(ResetPasswordDto, { token: 'T'.repeat(201), password: 'x'.repeat(8) })).toEqual(['token']);
  });
});

describe('VerifyEmailDto', () => {
  it('needs a token of a plausible length', async () => {
    expect(await errors(VerifyEmailDto, { token: TOKEN })).toEqual([]);
    expect(await errors(VerifyEmailDto, { token: 'short' })).toEqual(['token']);
    expect(await errors(VerifyEmailDto, {})).toEqual(['token']);
  });
});
