import { Body, Controller, Get, HttpCode, Ip, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.constants';
import type { AuthenticatedRequest } from './auth-user';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Ip() remoteAddress: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(input, remoteAddress);
    if (result.mfaRequired) return result;
    response.cookie(ACCESS_COOKIE, result.accessToken, this.accessCookieOptions());
    response.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...this.baseCookieOptions(),
      expires: result.refreshExpiresAt,
      path: '/api/v1/auth',
    });
    return { mfaRequired: false, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(refreshToken ?? '');
    response.cookie(ACCESS_COOKIE, result.accessToken, this.accessCookieOptions());
    return { user: result.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(refreshToken);
    response.clearCookie(ACCESS_COOKIE, this.accessCookieOptions());
    response.clearCookie(REFRESH_COOKIE, { ...this.baseCookieOptions(), path: '/api/v1/auth' });
  }

  @Get('me')
  currentUser(@Req() request: AuthenticatedRequest) {
    return { user: request.user };
  }

  private baseCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
    };
  }

  private accessCookieOptions(): CookieOptions {
    return { ...this.baseCookieOptions(), path: '/' };
  }
}
