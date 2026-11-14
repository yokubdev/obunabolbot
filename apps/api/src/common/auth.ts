import {
  CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { getOwnerByTgId, type Owner, type Sql, type TgUser } from "@obuna/core";
import { validateInitData } from "@obuna/telegram";
import { CONFIG, SQL } from "../tokens.js";
import type { AppConfig } from "../config.js";

interface AuthedRequest {
  headers: Record<string, string | undefined>;
  tgUser?: TgUser;
  owner?: Owner;
}

/**
 * Every request from the Mini App carries `Authorization: tma <initData>`, signed by Telegram.
 * With DEV_AUTH=true, `X-Dev-User: <telegram id>` is accepted instead (local browser testing only).
 */
@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.headers["authorization"] ?? "";
    if (auth.startsWith("tma ")) {
      const user = validateInitData(auth.slice(4), this.cfg.botToken);
      if (!user) throw new UnauthorizedException("Telegram imzosi yaroqsiz");
      req.tgUser = user;
      return true;
    }
    const dev = req.headers["x-dev-user"];
    if (this.cfg.devAuth && dev && /^\d+$/.test(dev)) {
      req.tgUser = { id: Number(dev), first_name: req.headers["x-dev-name"] ?? `Dev ${dev}` };
      return true;
    }
    throw new UnauthorizedException("Mini App orqali kiring");
  }
}

/** Requires the user to be a channel owner (they become one by adding the bot to a channel). */
@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const owner = req.tgUser && (await getOwnerByTgId(this.sql, req.tgUser.id));
    if (!owner) throw new ForbiddenException("Avval botni kanalingizga admin qiling");
    req.owner = owner;
    return true;
  }
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.tgUser || !this.cfg.platformAdminIds.includes(req.tgUser.id)) throw new ForbiddenException();
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().tgUser!;
});

export const CurrentOwner = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().owner!;
});
