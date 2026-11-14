import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from "@nestjs/common";
import { AppError } from "@obuna/core";
import { ProviderError } from "@obuna/atmos";
import { ZodError } from "zod";

/** Turns domain errors into `{ error: { code, message } }` JSON with a sensible status. */
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly log = new Logger("Errors");

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = 500;
    let code = "internal";
    let message = "Ichki xatolik";
    if (err instanceof AppError) [status, code, message] = [err.status, err.code, err.message];
    else if (err instanceof ProviderError) [status, code, message] = [402, err.code, err.message];
    else if (err instanceof ZodError) [status, code, message] = [400, "validation", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")];
    else if (err instanceof HttpException) {
      status = err.getStatus();
      code = `http_${status}`;
      const r = err.getResponse();
      message = typeof r === "string" ? r : ((r as { message?: string }).message ?? err.message);
    } else if ((err as { code?: string })?.code === "23505") {
      // Postgres unique violation: a concurrent duplicate, not a server bug.
      [status, code, message] = [409, "conflict", "Bu ma'lumot allaqachon mavjud"];
    } else this.log.error(err);
    res.status(status).json({ error: { code, message } });
  }
}
