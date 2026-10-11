import { Controller, Get, Logger, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InstagramDiscoveryOauthService } from './instagram-discovery-oauth.service';
import { InstagramDiscoveryConnectionService } from './instagram-discovery-connection.service';

const ADD_COMPETITOR = '/?add=competitor';

/**
 * connect/status are called by the SPA with its JWT; callback is reached by
 * Facebook's browser redirect, which cannot carry one. Every callback outcome
 * lands back in the add-competitor dialog, which shows any error.
 */
@Controller('instagram/discovery')
export class InstagramDiscoveryController {
  private readonly logger = new Logger(InstagramDiscoveryController.name);

  constructor(
    private oauth: InstagramDiscoveryOauthService,
    private connection: InstagramDiscoveryConnectionService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('connect')
  async connect() {
    return { redirectUrl: await this.oauth.buildAuthorizeUrl() };
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  status() {
    return this.connection.status();
  }

  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string, @Res() res: Response) {
    try {
      // Facebook sends error=access_denied and no code when the user cancels.
      if (!code) throw new Error('Вход через Facebook отменён');
      await this.oauth.completeLogin(code, state);
      res.redirect(ADD_COMPETITOR);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`Facebook discovery login failed: ${message}`);
      res.redirect(`${ADD_COMPETITOR}&discoveryError=${encodeURIComponent(message)}`);
    }
  }
}
