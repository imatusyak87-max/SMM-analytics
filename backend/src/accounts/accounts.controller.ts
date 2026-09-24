import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InstagramOauthService } from '../connectors/instagram/instagram-oauth.service';
import { InstagramAccountKind } from '../db/entities/instagram-oauth-state.entity';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateAccountFromLinkDto } from './dto/create-account-from-link.dto';

@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(
    private accountsService: AccountsService,
    private instagramOauth: InstagramOauthService,
  ) {}

  @Get('instagram/connect')
  async connectInstagram(@Query('type') type: 'own' | 'client') {
    const kind = type === 'own' ? InstagramAccountKind.OWN : InstagramAccountKind.CLIENT;
    const redirectUrl = await this.instagramOauth.buildAuthorizeUrl(kind);
    return { redirectUrl };
  }

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.accountsService.create(dto);
  }

  @Post('preview')
  preview(@Body() dto: CreateAccountFromLinkDto) {
    return this.accountsService.preview(dto.link);
  }

  @Get(':id/avatar')
  async avatar(@Param('id') id: string, @Res() res: Response) {
    const image = await this.accountsService.getAvatar(id);
    res.set({ 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=3600' });
    res.send(image.data);
  }

  @Post('from-link')
  createFromLink(@Body() dto: CreateAccountFromLinkDto) {
    return this.accountsService.createFromLink(dto.link);
  }

  @Get()
  findAll() {
    return this.accountsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.accountsService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accountsService.remove(id);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.accountsService.deactivate(id);
  }
}
