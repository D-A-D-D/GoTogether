import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { TripsService } from './trips.service.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { DiscoverTripsDto } from './dto/discover-trips.dto.js';
import { RemoveMemberDto } from './dto/remove-member.dto.js';
import { RespondToRequestDto } from './dto/respond-to-request.dto.js';
import { UpdateTripDto } from './dto/update-trip.dto.js';

@Controller('trips')
@UseGuards(JwtAccessGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTripDto) {
    return this.tripsService.create(user.userId, dto);
  }

  @Get('hosted')
  listHosted(@CurrentUser() user: RequestUser) {
    return this.tripsService.listHosted(user.userId);
  }

  @Get('mine')
  listMine(@CurrentUser() user: RequestUser) {
    return this.tripsService.listMine(user.userId);
  }

  @Get('discover')
  discover(@CurrentUser() user: RequestUser, @Query() dto: DiscoverTripsDto) {
    return this.tripsService.discover(user.userId, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tripsService.findById(id, user.userId);
  }

  @Post(':id/requests')
  requestToJoin(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tripsService.requestToJoin(id, user.userId);
  }

  @Get(':id/requests')
  listRequests(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tripsService.listRequests(id, user.userId);
  }

  @Get(':id/members')
  listMembers(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tripsService.listMembers(id, user.userId);
  }

  @Patch(':id/requests/:membershipId')
  respondToRequest(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: RespondToRequestDto,
  ) {
    return this.tripsService.respondToRequest(id, membershipId, user.userId, dto.decision);
  }

  @Post(':id/leave')
  leave(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tripsService.leave(id, user.userId);
  }

  @Delete(':id/members/:membershipId')
  removeMember(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: RemoveMemberDto,
  ) {
    return this.tripsService.removeMember(id, membershipId, user.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateTripDto) {
    return this.tripsService.update(id, user.userId, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tripsService.cancel(id, user.userId);
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tripsService.complete(id, user.userId);
  }
}
