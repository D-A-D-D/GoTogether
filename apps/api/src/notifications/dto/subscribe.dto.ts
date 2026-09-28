import { Type } from 'class-transformer';
import { IsString, IsUrl, ValidateNested } from 'class-validator';

class PushKeysDto {
  @IsString()
  p256dh!: string;

  @IsString()
  auth!: string;
}

// Shape of the browser's PushSubscription.toJSON() — endpoint + keys.
export class SubscribeDto {
  @IsUrl({ require_tld: false }) // push service endpoints are often bare-IP/localhost in dev
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}
