import { Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SyncJobService } from './sync-job.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class SyncController {
  constructor(private syncJobService: SyncJobService) {}

  @Post('accounts/:accountId/sync')
  triggerManualSync(@Param('accountId') accountId: string) {
    return this.syncJobService.createManual(accountId);
  }

  @Get('sync-jobs/:id')
  async getStatus(@Param('id') id: string) {
    const job = await this.syncJobService.findById(id);
    if (!job) throw new NotFoundException(`Sync job ${id} not found`);
    return job;
  }
}
