import { IsIn } from 'class-validator';
import { MembershipStatus } from '../../generated/prisma/index.js';

export class RespondToRequestDto {
  @IsIn([MembershipStatus.APPROVED, MembershipStatus.REJECTED])
  decision!: typeof MembershipStatus.APPROVED | typeof MembershipStatus.REJECTED;
}
