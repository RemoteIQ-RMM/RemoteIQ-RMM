// backend/src/tickets/tickets.module.ts
import { Module } from "@nestjs/common";
import { TicketsController } from "./tickets.controller";
import { TicketsService } from "./tickets.service";

// ✅ add these:
import { AuthModule } from "../auth/auth.module";        // provides JwtService (exports JwtModule)
import { StorageModule } from "../storage/storage.module"; // provides PgPoolService

// If you register the guard here, keep it; otherwise you can omit this import.
// (Only needed if you list AuthCookieGuard in `providers`.)
import { AuthCookieGuard } from "../auth/auth-cookie.guard";

@Module({
  // ⬇️ Keep your existing imported modules here; just add AuthModule and StorageModule.
  imports: [
    AuthModule,
    StorageModule,
    // ...any other modules you already had
  ],
  controllers: [
    TicketsController,
    // ...any other controllers you already had
  ],
  providers: [
    TicketsService,
    AuthCookieGuard, // keep only if you were already providing it here
    // ...any other providers you already had
  ],
  exports: [
    TicketsService,
    // ...anything you were already exporting
  ],
})
export class TicketsModule { }
