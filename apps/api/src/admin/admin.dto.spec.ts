import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetAccountStatusDto } from './dto/admin.dto.js';

const check = (status: unknown) => validate(plainToInstance(SetAccountStatusDto, { status, reason: 'because' }));

describe('SetAccountStatusDto — which statuses a moderator can set', () => {
  it.each(['ACTIVE', 'SUSPENDED', 'BANNED'])('accepts %s', async (status) => {
    expect(await check(status)).toEqual([]);
  });

  it('refuses DELETED — only a person can delete their own account, a moderator cannot', async () => {
    const errors = await check('DELETED');
    expect(errors.map((e) => e.property)).toEqual(['status']);
  });

  it.each(['ADMIN', 'active', '', undefined, 3])('refuses %j', async (status) => {
    expect((await check(status)).length).toBeGreaterThan(0);
  });
});
