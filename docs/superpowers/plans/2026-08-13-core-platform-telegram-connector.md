# Core Platform + Telegram Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full core platform (DB, auth, sync pipeline, API, all 3 frontend pages) with Telegram as the one working, end-to-end reference connector. This is the first of five plans — plans 2-5 each add one more platform connector (VK, YouTube, Instagram, LinkedIn) following the pattern this plan establishes.

**Architecture:** NestJS + TypeORM + PostgreSQL backend, exposing a REST API consumed by a React + TypeScript (Vite) frontend. BullMQ (Redis-backed) runs scheduled (daily cron) and manual ("refresh now") data-collection jobs against a `SocialConnector` interface. Telegram is push-based (Bot API webhook for posts) unlike the pull-based connectors that come in later plans, so this plan also establishes the webhook-ingestion pattern alongside the pull pattern.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, BullMQ + Redis, Passport-JWT, bcrypt, React 18, Vite, TypeScript, react-router-dom, recharts, axios, Jest (backend), Vitest + Testing Library (frontend), Playwright (e2e), Docker Compose.

**Spec:** [docs/superpowers/specs/2026-08-13-social-media-dashboard-design.md](../specs/2026-08-13-social-media-dashboard-design.md)

## Global Constraints

- Data source: official platform APIs only, no scraping (spec §1).
- Telegram in this plan is Bot-API only: no views/reach/post history backfill, no MTProto (per explicit decision) — followers via `getChatMemberCount`, posts captured live via webhook only.
- Single user role, no client-facing access (spec §7).
- Social platform tokens (`account_credentials.encrypted_token`) must be stored AES-encrypted, key from env var, never in code (spec §7).
- Sync jobs run through the BullMQ queue, never synchronously in an HTTP request handler (spec §5).
- All monetary/metric numeric columns use the field names given in spec §4 (`followers_count`, `avg_er`, `er`, etc.) — later tasks and the frontend depend on these exact names.

---

## Task 1: Backend scaffolding

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/nest-cli.json`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/health/health.controller.ts`
- Create: `backend/src/health/health.controller.spec.ts`
- Create: `backend/.env.example`

**Interfaces:**
- Produces: `GET /health` → `{ status: 'ok' }`. `AppModule` is the root module later tasks import their modules into.

- [ ] **Step 1: Scaffold the NestJS project**

```bash
cd backend
npx @nestjs/cli new . --package-manager npm --skip-git
npm install @nestjs/config
```

- [ ] **Step 2: Write the health controller**

```typescript
// backend/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 3: Write the failing test**

```typescript
// backend/src/health/health.controller.spec.ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns status ok', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const controller = moduleRef.get(HealthController);
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- health.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Wire into AppModule and add env config**

```typescript
// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
})
export class AppModule {}
```

```
# backend/.env.example
DATABASE_URL=postgres://postgres:postgres@localhost:5432/smm_dashboard
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me
CREDENTIAL_ENCRYPTION_KEY=change-me-32-bytes-hex
TELEGRAM_WEBHOOK_SECRET=change-me
PORT=3000
```

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "chore: scaffold NestJS backend with health endpoint"
```

---

## Task 2: Frontend scaffolding

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`
- Create: `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Create: `frontend/src/App.test.tsx`
- Create: `frontend/.env.example`

**Interfaces:**
- Produces: `App` component with `react-router-dom` routes: `/login`, `/`, `/accounts/:id`, `/compare` (pages stubbed, filled in Tasks 18-22).

- [ ] **Step 1: Scaffold the Vite React TS project**

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install react-router-dom axios recharts
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Write App shell with routing**

```tsx
// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

function Placeholder({ label }: { label: string }) {
  return <div>{label}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Placeholder label="login" />} />
        <Route path="/" element={<Placeholder label="overview" />} />
        <Route path="/accounts/:id" element={<Placeholder label="detail" />} />
        <Route path="/compare" element={<Placeholder label="compare" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Write the failing test**

```tsx
// frontend/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the overview placeholder at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('overview')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Configure vitest and run**

```typescript
// frontend/vite.config.ts (add to existing defineConfig)
/// <reference types="vitest" />
export default {
  test: { environment: 'jsdom', globals: true, setupFiles: './src/setupTests.ts' },
};
```

```typescript
// frontend/src/setupTests.ts
import '@testing-library/jest-dom';
```

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "chore: scaffold Vite React frontend with route shell"
```

---

## Task 3: Docker Compose infrastructure

**Files:**
- Create: `docker-compose.yml`
- Create: `backend/Dockerfile`
- Create: `frontend/Dockerfile`
- Create: `.env.example` (root, compose-level)

**Interfaces:**
- Produces: services `postgres` (5432), `redis` (6379), `backend` (3000), `frontend` (5173) reachable from each other by service name on the compose network.

- [ ] **Step 1: Write backend Dockerfile**

```dockerfile
# backend/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "dist/main.js"]
```

- [ ] **Step 2: Write frontend Dockerfile**

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "dev", "--", "--host"]
```

- [ ] **Step 3: Write docker-compose.yml**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: smm_dashboard
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  backend:
    build: ./backend
    env_file: .env
    depends_on: [postgres, redis]
    ports: ["3000:3000"]

  frontend:
    build: ./frontend
    depends_on: [backend]
    ports: ["5173:5173"]

volumes:
  pgdata:
```

```
# .env.example (root)
DATABASE_URL=postgres://postgres:postgres@postgres:5432/smm_dashboard
REDIS_URL=redis://redis:6379
JWT_SECRET=change-me
CREDENTIAL_ENCRYPTION_KEY=change-me-32-bytes-hex
TELEGRAM_WEBHOOK_SECRET=change-me
PORT=3000
```

- [ ] **Step 4: Verify the stack builds and starts**

Run: `docker compose up -d --build && docker compose ps`
Expected: all four services show state `running`/`Up`.

- [ ] **Step 5: Tear down and commit**

```bash
docker compose down
git add docker-compose.yml backend/Dockerfile frontend/Dockerfile .env.example
git commit -m "chore: add docker compose infrastructure"
```

---

## Task 4: Data model — entities and migrations

**Files:**
- Create: `backend/src/db/entities/user.entity.ts`
- Create: `backend/src/db/entities/account.entity.ts`
- Create: `backend/src/db/entities/account-credential.entity.ts`
- Create: `backend/src/db/entities/account-snapshot.entity.ts`
- Create: `backend/src/db/entities/post.entity.ts`
- Create: `backend/src/db/entities/sync-job.entity.ts`
- Create: `backend/src/db/data-source.ts`
- Create: `backend/src/db/db.module.ts`
- Create: `backend/test/db-roundtrip.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `AccountPlatform` enum (`telegram|instagram|vk|youtube|linkedin`), `AccountType` enum (`own|client|public_no_access`), `PostType` enum (`post|reel|carousel|video|short|story`), `SyncTrigger` enum (`scheduled|manual`), `SyncStatus` enum (`pending|running|success|failed`), and the six TypeORM entity classes below with the exact field names shown — every later task imports these from `backend/src/db/entities/*`.

- [ ] **Step 1: Install TypeORM and pg driver**

```bash
cd backend
npm install typeorm pg @nestjs/typeorm
```

- [ ] **Step 2: Write the entities**

```typescript
// backend/src/db/entities/user.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column() passwordHash: string;
  @Column() name: string;
  @CreateDateColumn() createdAt: Date;
}
```

```typescript
// backend/src/db/entities/account.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum AccountPlatform {
  TELEGRAM = 'telegram',
  INSTAGRAM = 'instagram',
  VK = 'vk',
  YOUTUBE = 'youtube',
  LINKEDIN = 'linkedin',
}

export enum AccountType {
  OWN = 'own',
  CLIENT = 'client',
  PUBLIC_NO_ACCESS = 'public_no_access',
}

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'enum', enum: AccountPlatform }) platform: AccountPlatform;
  @Column() externalId: string;
  @Column() name: string;
  @Column({ nullable: true, type: 'text' }) avatarUrl: string | null;
  @Column({ type: 'enum', enum: AccountType }) type: AccountType;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}
```

```typescript
// backend/src/db/entities/account-credential.entity.ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('account_credentials')
export class AccountCredential {
  @PrimaryColumn('uuid') accountId: string;
  @Column({ type: 'text' }) encryptedToken: string;
  @Column({ nullable: true, type: 'timestamptz' }) tokenExpiresAt: Date | null;
  @Column({ nullable: true, type: 'text' }) refreshToken: string | null;
}
```

```typescript
// backend/src/db/entities/account-snapshot.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

@Entity('account_snapshots')
@Unique(['accountId', 'date'])
export class AccountSnapshot {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column({ type: 'date' }) date: string;
  @Column('int') followersCount: number;
  @Column('int', { nullable: true }) followingCount: number | null;
  @Column('int') postsCount: number;
  @Column('float', { nullable: true }) avgReach: number | null;
  @Column('float', { nullable: true }) avgEr: number | null;
}
```

```typescript
// backend/src/db/entities/post.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

export enum PostType {
  POST = 'post',
  REEL = 'reel',
  CAROUSEL = 'carousel',
  VIDEO = 'video',
  SHORT = 'short',
  STORY = 'story',
}

@Entity('posts')
@Unique(['accountId', 'externalPostId'])
export class Post {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column() externalPostId: string;
  @Column({ type: 'enum', enum: PostType }) type: PostType;
  @Column({ type: 'timestamptz' }) publishedAt: Date;
  @Column({ nullable: true, type: 'text' }) permalink: string | null;
  @Column({ nullable: true, type: 'text' }) thumbnailUrl: string | null;
  @Column({ nullable: true, type: 'text' }) caption: string | null;
  @Column('int', { default: 0 }) likes: number;
  @Column('int', { default: 0 }) comments: number;
  @Column('int', { default: 0 }) shares: number;
  @Column('int', { nullable: true }) views: number | null;
  @Column('int', { nullable: true }) reach: number | null;
  @Column('float', { nullable: true }) er: number | null;
  @Column({ type: 'timestamptz' }) lastSyncedAt: Date;
}
```

```typescript
// backend/src/db/entities/sync-job.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum SyncTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
}

export enum SyncStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('sync_jobs')
export class SyncJob {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column({ type: 'enum', enum: SyncTrigger }) trigger: SyncTrigger;
  @Column({ type: 'enum', enum: SyncStatus, default: SyncStatus.PENDING }) status: SyncStatus;
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
  @Column({ nullable: true, type: 'timestamptz' }) startedAt: Date | null;
  @Column({ nullable: true, type: 'timestamptz' }) finishedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}
```

- [ ] **Step 3: Write the DataSource and DbModule**

```typescript
// backend/src/db/data-source.ts
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Account } from './entities/account.entity';
import { AccountCredential } from './entities/account-credential.entity';
import { AccountSnapshot } from './entities/account-snapshot.entity';
import { Post } from './entities/post.entity';
import { SyncJob } from './entities/sync-job.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Account, AccountCredential, AccountSnapshot, Post, SyncJob],
  migrations: ['src/db/migrations/*.ts'],
  synchronize: false,
});
```

```typescript
// backend/src/db/db.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Account } from './entities/account.entity';
import { AccountCredential } from './entities/account-credential.entity';
import { AccountSnapshot } from './entities/account-snapshot.entity';
import { Post } from './entities/post.entity';
import { SyncJob } from './entities/sync-job.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [User, Account, AccountCredential, AccountSnapshot, Post, SyncJob],
      synchronize: process.env.NODE_ENV === 'test',
    }),
    TypeOrmModule.forFeature([User, Account, AccountCredential, AccountSnapshot, Post, SyncJob]),
  ],
  exports: [TypeOrmModule],
})
export class DbModule {}
```

- [ ] **Step 4: Generate the initial migration**

```bash
cd backend
npx typeorm-ts-node-commonjs migration:generate src/db/migrations/InitialSchema -d src/db/data-source.ts
```

- [ ] **Step 5: Write the round-trip integration test**

```typescript
// backend/test/db-roundtrip.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { DbModule } from '../src/db/db.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountPlatform, AccountType } from '../src/db/entities/account.entity';
import { AccountSnapshot } from '../src/db/entities/account-snapshot.entity';

describe('DB round-trip', () => {
  let accountRepo: Repository<Account>;
  let snapshotRepo: Repository<AccountSnapshot>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DbModule] }).compile();
    accountRepo = moduleRef.get(getRepositoryToken(Account));
    snapshotRepo = moduleRef.get(getRepositoryToken(AccountSnapshot));
  });

  it('creates an account and a snapshot referencing it', async () => {
    const account = await accountRepo.save({
      platform: AccountPlatform.TELEGRAM,
      externalId: '@testchannel',
      name: 'Test Channel',
      avatarUrl: null,
      type: AccountType.OWN,
    });

    const snapshot = await snapshotRepo.save({
      accountId: account.id,
      date: '2026-08-13',
      followersCount: 100,
      followingCount: null,
      postsCount: 5,
      avgReach: null,
      avgEr: 2.5,
    });

    const found = await snapshotRepo.findOneBy({ id: snapshot.id });
    expect(found?.accountId).toBe(account.id);
    expect(found?.followersCount).toBe(100);
  });
});
```

- [ ] **Step 6: Run migrations against test DB and run the test**

Run: `docker compose up -d postgres && cd backend && NODE_ENV=test DATABASE_URL=postgres://postgres:postgres@localhost:5432/smm_dashboard npm run test:e2e -- db-roundtrip.e2e-spec.ts`
Expected: PASS (test run uses `synchronize: true` in test env, so no manual migration step needed for the test itself; migration file still committed for prod/dev use)

- [ ] **Step 7: Wire DbModule into AppModule and commit**

```typescript
// backend/src/app.module.ts — add DbModule to imports array alongside ConfigModule
```

```bash
git add backend/src/db backend/test/db-roundtrip.e2e-spec.ts backend/src/app.module.ts
git commit -m "feat: add data model entities and initial migration"
```

---

## Task 5: Auth — login and JWT guard

**Files:**
- Create: `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.service.spec.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/jwt.strategy.ts`
- Create: `backend/src/auth/jwt-auth.guard.ts`
- Create: `backend/src/auth/dto/login.dto.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `User` entity from Task 4 (`backend/src/db/entities/user.entity.ts`).
- Produces: `POST /auth/login` → `{ accessToken: string }`. `JwtAuthGuard` — apply as `@UseGuards(JwtAuthGuard)` on any controller from Tasks 6+ that must be authenticated. `AuthService.validateUser(email, password): Promise<User | null>` and `AuthService.login(user): { accessToken: string }`.

- [ ] **Step 1: Install auth dependencies**

```bash
cd backend
npm install @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt
npm install -D @types/passport-jwt @types/bcrypt
```

- [ ] **Step 2: Write the failing AuthService test**

```typescript
// backend/src/auth/auth.service.spec.ts
import { AuthService } from './auth.service';
import * as bcrypt from 'bcrypt';

describe('AuthService.validateUser', () => {
  it('returns the user when password matches', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const usersRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: '1', email: 'a@b.com', passwordHash, name: 'A' }),
    } as any;
    const jwtService = { sign: jest.fn() } as any;
    const service = new AuthService(usersRepo, jwtService);

    const result = await service.validateUser('a@b.com', 'correct-horse');
    expect(result?.email).toBe('a@b.com');
  });

  it('returns null when password does not match', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const usersRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: '1', email: 'a@b.com', passwordHash, name: 'A' }),
    } as any;
    const jwtService = { sign: jest.fn() } as any;
    const service = new AuthService(usersRepo, jwtService);

    const result = await service.validateUser('a@b.com', 'wrong');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `cd backend && npm test -- auth.service.spec.ts`
Expected: FAIL (`AuthService` not defined)

- [ ] **Step 3: Implement AuthService**

```typescript
// backend/src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../db/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersRepo.findOneBy({ email });
    if (!user) return null;
    const matches = await bcrypt.compare(password, user.passwordHash);
    return matches ? user : null;
  }

  login(user: User): { accessToken: string } {
    return { accessToken: this.jwtService.sign({ sub: user.id, email: user.email }) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- auth.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write JWT strategy, guard, DTO, controller, module**

```typescript
// backend/src/auth/dto/login.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}
```

```typescript
// backend/src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    return { userId: payload.sub, email: payload.email };
  }
}
```

```typescript
// backend/src/auth/jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

```typescript
// backend/src/auth/auth.controller.ts
import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return this.authService.login(user);
  }
}
```

```typescript
// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../db/entities/user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '12h' } }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 6: Wire into AppModule, seed one user via a one-off script, verify login manually**

```typescript
// backend/src/app.module.ts — add AuthModule to imports array
```

Run: `docker compose up -d postgres && cd backend && npm run start:dev`, then in another shell insert a user row with a bcrypt hash and call `curl -X POST localhost:3000/auth/login -d '{"email":"a@b.com","password":"correct-horse"}' -H 'Content-Type: application/json'`
Expected: JSON response with `accessToken`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth backend/src/app.module.ts
git commit -m "feat: add JWT auth with login endpoint"
```

---

## Task 6: Accounts module (CRUD)

**Files:**
- Create: `backend/src/accounts/accounts.module.ts`
- Create: `backend/src/accounts/accounts.service.ts`
- Create: `backend/src/accounts/accounts.service.spec.ts`
- Create: `backend/src/accounts/accounts.controller.ts`
- Create: `backend/src/accounts/dto/create-account.dto.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `Account`, `AccountPlatform`, `AccountType` from Task 4. `JwtAuthGuard` from Task 5.
- Produces: `AccountsService.create(dto)`, `.findAll()`, `.findOne(id)`, `.deactivate(id)`. Endpoints `POST /accounts`, `GET /accounts`, `GET /accounts/:id`, `PATCH /accounts/:id/deactivate` — all guarded by `JwtAuthGuard`. Later tasks (Sync, Stats) read accounts via `AccountsService.findOne`/`findAll`.

- [ ] **Step 1: Write the failing service test**

```typescript
// backend/src/accounts/accounts.service.spec.ts
import { AccountsService } from './accounts.service';
import { AccountPlatform, AccountType } from '../db/entities/account.entity';

describe('AccountsService', () => {
  it('creates an account with isActive true by default', async () => {
    const saved = { id: '1' };
    const repo = { save: jest.fn().mockResolvedValue(saved), create: jest.fn((x) => x) } as any;
    const service = new AccountsService(repo);

    const result = await service.create({
      platform: AccountPlatform.TELEGRAM,
      externalId: '@chan',
      name: 'Chan',
      type: AccountType.OWN,
    });

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
    expect(result).toBe(saved);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- accounts.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement DTO and service**

```typescript
// backend/src/accounts/dto/create-account.dto.ts
import { IsEnum, IsString, IsOptional } from 'class-validator';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

export class CreateAccountDto {
  @IsEnum(AccountPlatform) platform: AccountPlatform;
  @IsString() externalId: string;
  @IsString() name: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsEnum(AccountType) type: AccountType;
}
```

```typescript
// backend/src/accounts/accounts.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  constructor(@InjectRepository(Account) private repo: Repository<Account>) {}

  create(dto: CreateAccountDto) {
    return this.repo.save(this.repo.create({ ...dto, avatarUrl: dto.avatarUrl ?? null, isActive: true }));
  }

  findAll() {
    return this.repo.find({ where: { isActive: true } });
  }

  async findOne(id: string) {
    const account = await this.repo.findOneBy({ id });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  async deactivate(id: string) {
    await this.findOne(id);
    await this.repo.update(id, { isActive: false });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- accounts.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write controller and module**

```typescript
// backend/src/accounts/accounts.controller.ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';

@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private accountsService: AccountsService) {}

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.accountsService.create(dto);
  }

  @Get()
  findAll() {
    return this.accountsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.accountsService.findOne(id);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.accountsService.deactivate(id);
  }
}
```

```typescript
// backend/src/accounts/accounts.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
```

- [ ] **Step 6: Wire into AppModule and commit**

```bash
git add backend/src/accounts backend/src/app.module.ts
git commit -m "feat: add accounts CRUD module"
```

---

## Task 7: Connector interface and registry

**Files:**
- Create: `backend/src/connectors/connector.interface.ts`
- Create: `backend/src/connectors/connector-registry.service.ts`
- Create: `backend/src/connectors/connector-registry.service.spec.ts`
- Create: `backend/src/connectors/connectors.module.ts`

**Interfaces:**
- Consumes: `AccountPlatform` from Task 4, `PostType` from Task 4.
- Produces: `SocialConnector` interface and `ConnectorRegistry.get(platform: AccountPlatform): SocialConnector` — used by the sync processor (Task 12) to dispatch to the right connector, and by every future platform-specific connector task to register itself.

- [ ] **Step 1: Write the connector interface**

```typescript
// backend/src/connectors/connector.interface.ts
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { PostType } from '../db/entities/post.entity';

export interface AccountInfo {
  name: string;
  avatarUrl: string | null;
}

export interface AccountStats {
  followersCount: number;
  followingCount: number | null;
  postsCount: number;
}

export interface ConnectorPost {
  externalPostId: string;
  type: PostType;
  publishedAt: Date;
  permalink: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number | null;
  reach: number | null;
}

/**
 * getPosts may return [] for push-based platforms (e.g. Telegram Bot API,
 * which delivers posts via webhook, not on-demand fetch) — callers must
 * not treat an empty array as a sync failure.
 */
export interface SocialConnector {
  platform: AccountPlatform;
  getAccountInfo(account: Account): Promise<AccountInfo>;
  getAccountStats(account: Account): Promise<AccountStats>;
  getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]>;
}
```

- [ ] **Step 2: Write the failing registry test**

```typescript
// backend/src/connectors/connector-registry.service.spec.ts
import { ConnectorRegistry } from './connector-registry.service';
import { AccountPlatform } from '../db/entities/account.entity';
import { SocialConnector } from './connector.interface';

describe('ConnectorRegistry', () => {
  it('returns the connector registered for a platform', () => {
    const fakeConnector = { platform: AccountPlatform.TELEGRAM } as SocialConnector;
    const registry = new ConnectorRegistry([fakeConnector]);
    expect(registry.get(AccountPlatform.TELEGRAM)).toBe(fakeConnector);
  });

  it('throws for an unregistered platform', () => {
    const registry = new ConnectorRegistry([]);
    expect(() => registry.get(AccountPlatform.VK)).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- connector-registry.service.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement the registry**

```typescript
// backend/src/connectors/connector-registry.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { AccountPlatform } from '../db/entities/account.entity';
import { SocialConnector } from './connector.interface';

export const CONNECTORS = 'CONNECTORS';

@Injectable()
export class ConnectorRegistry {
  private byPlatform = new Map<AccountPlatform, SocialConnector>();

  constructor(@Inject(CONNECTORS) connectors: SocialConnector[]) {
    for (const connector of connectors) {
      this.byPlatform.set(connector.platform, connector);
    }
  }

  get(platform: AccountPlatform): SocialConnector {
    const connector = this.byPlatform.get(platform);
    if (!connector) throw new Error(`No connector registered for platform ${platform}`);
    return connector;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- connector-registry.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Write the connectors module (empty provider list for now, filled in Task 9)**

```typescript
// backend/src/connectors/connectors.module.ts
import { Module } from '@nestjs/common';
import { ConnectorRegistry, CONNECTORS } from './connector-registry.service';

@Module({
  providers: [
    { provide: CONNECTORS, useFactory: () => [] },
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class ConnectorsModule {}
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/connectors
git commit -m "feat: add SocialConnector interface and connector registry"
```

---

## Task 8: Telegram API client

**Files:**
- Create: `backend/src/connectors/telegram/telegram-api.client.ts`
- Create: `backend/src/connectors/telegram/telegram-api.client.spec.ts`

**Interfaces:**
- Produces: `TelegramApiClient.getChat(chatId: string): Promise<{ title: string; photoUrl: string | null }>` and `.getChatMemberCount(chatId: string): Promise<number>`, both using a bot token passed to the constructor. Consumed by `TelegramConnector` in Task 9.

- [ ] **Step 1: Install axios**

```bash
cd backend
npm install axios
```

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/connectors/telegram/telegram-api.client.spec.ts
import axios from 'axios';
import { TelegramApiClient } from './telegram-api.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TelegramApiClient', () => {
  it('getChatMemberCount returns the member count from the Bot API response', async () => {
    mockedAxios.get.mockResolvedValue({ data: { ok: true, result: 1234 } });
    const client = new TelegramApiClient('fake-token');

    const count = await client.getChatMemberCount('@testchannel');

    expect(count).toBe(1234);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.telegram.org/botfake-token/getChatMemberCount',
      { params: { chat_id: '@testchannel' } },
    );
  });

  it('getChat returns title and photo url when present', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { ok: true, result: { title: 'Test Channel', photo: { big_file_id: 'abc' } } },
    });
    const client = new TelegramApiClient('fake-token');

    const chat = await client.getChat('@testchannel');

    expect(chat.title).toBe('Test Channel');
  });

  it('throws when the Bot API returns ok: false', async () => {
    mockedAxios.get.mockResolvedValue({ data: { ok: false, description: 'Forbidden: bot is not a member' } });
    const client = new TelegramApiClient('fake-token');

    await expect(client.getChatMemberCount('@testchannel')).rejects.toThrow('Forbidden: bot is not a member');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- telegram-api.client.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement the client**

```typescript
// backend/src/connectors/telegram/telegram-api.client.ts
import axios from 'axios';

export class TelegramApiClient {
  private baseUrl: string;

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  private async call<T>(method: string, params: Record<string, string>): Promise<T> {
    const { data } = await axios.get(`${this.baseUrl}/${method}`, { params });
    if (!data.ok) throw new Error(data.description ?? `Telegram API call to ${method} failed`);
    return data.result as T;
  }

  async getChatMemberCount(chatId: string): Promise<number> {
    return this.call<number>('getChatMemberCount', { chat_id: chatId });
  }

  async getChat(chatId: string): Promise<{ title: string; photoUrl: string | null }> {
    const result = await this.call<{ title: string; photo?: { big_file_id: string } }>('getChat', {
      chat_id: chatId,
    });
    return { title: result.title, photoUrl: result.photo ? result.photo.big_file_id : null };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- telegram-api.client.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/connectors/telegram/telegram-api.client.ts backend/src/connectors/telegram/telegram-api.client.spec.ts
git commit -m "feat: add Telegram Bot API HTTP client"
```

---

## Task 9: Telegram connector

**Files:**
- Create: `backend/src/connectors/telegram/telegram.connector.ts`
- Create: `backend/src/connectors/telegram/telegram.connector.spec.ts`
- Modify: `backend/src/connectors/connectors.module.ts`

**Interfaces:**
- Consumes: `TelegramApiClient` from Task 8, `SocialConnector`/`AccountInfo`/`AccountStats` from Task 7.
- Produces: `TelegramConnector implements SocialConnector` registered in `ConnectorsModule`'s `CONNECTORS` provider — dispatched to by `ConnectorRegistry.get(AccountPlatform.TELEGRAM)` in the sync processor (Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/connectors/telegram/telegram.connector.spec.ts
import { TelegramConnector } from './telegram.connector';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

describe('TelegramConnector', () => {
  const account = {
    id: '1',
    platform: AccountPlatform.TELEGRAM,
    externalId: '@testchannel',
    name: 'Test',
    avatarUrl: null,
    type: AccountType.OWN,
    isActive: true,
    createdAt: new Date(),
  };

  it('getAccountStats maps member count to followersCount', async () => {
    const client = { getChatMemberCount: jest.fn().mockResolvedValue(1234), getChat: jest.fn() } as any;
    const connector = new TelegramConnector(client);

    const stats = await connector.getAccountStats(account);

    expect(stats.followersCount).toBe(1234);
    expect(stats.followingCount).toBeNull();
  });

  it('getAccountInfo maps chat title and photo', async () => {
    const client = {
      getChat: jest.fn().mockResolvedValue({ title: 'Test Channel', photoUrl: 'file123' }),
      getChatMemberCount: jest.fn(),
    } as any;
    const connector = new TelegramConnector(client);

    const info = await connector.getAccountInfo(account);

    expect(info.name).toBe('Test Channel');
    expect(info.avatarUrl).toBe('file123');
  });

  it('getPosts returns an empty array (posts arrive via webhook, not pull)', async () => {
    const client = {} as any;
    const connector = new TelegramConnector(client);

    const posts = await connector.getPosts(account, new Date());

    expect(posts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- telegram.connector.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the connector**

```typescript
// backend/src/connectors/telegram/telegram.connector.ts
import { AccountPlatform, Account } from '../../db/entities/account.entity';
import { AccountInfo, AccountStats, ConnectorPost, SocialConnector } from '../connector.interface';
import { TelegramApiClient } from './telegram-api.client';

export class TelegramConnector implements SocialConnector {
  platform = AccountPlatform.TELEGRAM;

  constructor(private client: TelegramApiClient) {}

  async getAccountInfo(account: Account): Promise<AccountInfo> {
    const chat = await this.client.getChat(account.externalId);
    return { name: chat.title, avatarUrl: chat.photoUrl };
  }

  async getAccountStats(account: Account): Promise<AccountStats> {
    const count = await this.client.getChatMemberCount(account.externalId);
    return { followersCount: count, followingCount: null, postsCount: 0 };
  }

  async getPosts(_account: Account, _sinceDate: Date): Promise<ConnectorPost[]> {
    // Telegram Bot API cannot pull post history or views; posts are
    // ingested live via the webhook in Task 10 instead.
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- telegram.connector.spec.ts`
Expected: PASS

- [ ] **Step 5: Register the connector in ConnectorsModule**

```typescript
// backend/src/connectors/connectors.module.ts
import { Module } from '@nestjs/common';
import { ConnectorRegistry, CONNECTORS } from './connector-registry.service';
import { TelegramApiClient } from './telegram/telegram-api.client';
import { TelegramConnector } from './telegram/telegram.connector';

@Module({
  providers: [
    {
      provide: CONNECTORS,
      useFactory: () => [new TelegramConnector(new TelegramApiClient(process.env.TELEGRAM_BOT_TOKEN as string))],
    },
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class ConnectorsModule {}
```

Add `TELEGRAM_BOT_TOKEN=` to `backend/.env.example` and root `.env.example`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/connectors backend/.env.example .env.example
git commit -m "feat: add Telegram connector (stats + account info, no post pull)"
```

---

## Task 10: Telegram webhook — post ingestion

**Files:**
- Create: `backend/src/connectors/telegram/telegram-webhook.controller.ts`
- Create: `backend/src/connectors/telegram/telegram-webhook.controller.spec.ts`
- Create: `backend/src/connectors/telegram/telegram-post-mapper.ts`
- Create: `backend/src/connectors/telegram/telegram-post-mapper.spec.ts`
- Modify: `backend/src/connectors/connectors.module.ts`

**Interfaces:**
- Consumes: `Post`, `PostType` from Task 4; `Account` repository (via TypeORM) from Task 4.
- Produces: `POST /webhooks/telegram/:accountId` — Telegram calls this with `channel_post` updates. `mapTelegramMessageToPost(message): { externalPostId, type, publishedAt, permalink, caption, likes, comments, shares, views, reach }` used directly by the controller and reusable by tests.

- [ ] **Step 1: Write the failing mapper test**

```typescript
// backend/src/connectors/telegram/telegram-post-mapper.spec.ts
import { mapTelegramMessageToPost } from './telegram-post-mapper';
import { PostType } from '../../db/entities/post.entity';

describe('mapTelegramMessageToPost', () => {
  it('maps a text-only post to type "post"', () => {
    const message = { message_id: 42, date: 1755000000, text: 'Hello world' };
    const result = mapTelegramMessageToPost(message, '@testchannel');
    expect(result.externalPostId).toBe('42');
    expect(result.type).toBe(PostType.POST);
    expect(result.caption).toBe('Hello world');
    expect(result.likes).toBe(0);
    expect(result.views).toBeNull();
  });

  it('maps a video message to type "video"', () => {
    const message = { message_id: 43, date: 1755000000, caption: 'A video', video: { file_id: 'v1' } };
    const result = mapTelegramMessageToPost(message, '@testchannel');
    expect(result.type).toBe(PostType.VIDEO);
  });

  it('maps a media_group (album) message to type "carousel"', () => {
    const message = { message_id: 44, date: 1755000000, media_group_id: 'g1', photo: [{ file_id: 'p1' }] };
    const result = mapTelegramMessageToPost(message, '@testchannel');
    expect(result.type).toBe(PostType.CAROUSEL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- telegram-post-mapper.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the mapper**

```typescript
// backend/src/connectors/telegram/telegram-post-mapper.ts
import { PostType } from '../../db/entities/post.entity';

interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  video?: unknown;
  photo?: unknown;
  media_group_id?: string;
}

export interface MappedTelegramPost {
  externalPostId: string;
  type: PostType;
  publishedAt: Date;
  permalink: string;
  caption: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number | null;
  reach: number | null;
}

export function mapTelegramMessageToPost(message: TelegramMessage, channelUsername: string): MappedTelegramPost {
  let type = PostType.POST;
  if (message.media_group_id) type = PostType.CAROUSEL;
  else if (message.video) type = PostType.VIDEO;

  return {
    externalPostId: String(message.message_id),
    type,
    publishedAt: new Date(message.date * 1000),
    permalink: `https://t.me/${channelUsername.replace('@', '')}/${message.message_id}`,
    caption: message.text ?? message.caption ?? null,
    likes: 0,
    comments: 0,
    shares: 0,
    views: null,
    reach: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- telegram-post-mapper.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the failing controller test**

```typescript
// backend/src/connectors/telegram/telegram-webhook.controller.spec.ts
import { TelegramWebhookController } from './telegram-webhook.controller';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

describe('TelegramWebhookController', () => {
  it('upserts a post derived from a channel_post update', async () => {
    const account = { id: 'acc-1', externalId: '@testchannel', platform: AccountPlatform.TELEGRAM, type: AccountType.OWN };
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) } as any;
    const postsRepo = { upsert: jest.fn() } as any;
    const controller = new TelegramWebhookController(accountsRepo, postsRepo);

    await controller.handleUpdate('acc-1', {
      channel_post: { message_id: 42, date: 1755000000, text: 'Hello world' },
    });

    expect(postsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', externalPostId: '42', caption: 'Hello world' }),
      ['accountId', 'externalPostId'],
    );
  });

  it('does nothing when the update has no channel_post', async () => {
    const accountsRepo = { findOneBy: jest.fn() } as any;
    const postsRepo = { upsert: jest.fn() } as any;
    const controller = new TelegramWebhookController(accountsRepo, postsRepo);

    await controller.handleUpdate('acc-1', { message: { message_id: 1 } });

    expect(postsRepo.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npm test -- telegram-webhook.controller.spec.ts`
Expected: FAIL

- [ ] **Step 7: Implement the controller**

```typescript
// backend/src/connectors/telegram/telegram-webhook.controller.ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../../db/entities/account.entity';
import { Post as PostEntity } from '../../db/entities/post.entity';
import { mapTelegramMessageToPost } from './telegram-post-mapper';

@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(PostEntity) private postsRepo: Repository<PostEntity>,
  ) {}

  @Post(':accountId')
  async handleUpdate(@Param('accountId') accountId: string, @Body() update: { channel_post?: any }) {
    if (!update.channel_post) return;

    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) return;

    const mapped = mapTelegramMessageToPost(update.channel_post, account.externalId);
    await this.postsRepo.upsert(
      { accountId, ...mapped, lastSyncedAt: new Date() },
      ['accountId', 'externalPostId'],
    );
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && npm test -- telegram-webhook.controller.spec.ts`
Expected: PASS

- [ ] **Step 9: Register controller in ConnectorsModule and commit**

```typescript
// backend/src/connectors/connectors.module.ts — add imports: TypeOrmModule.forFeature([Account, Post])
// and controllers: [TelegramWebhookController]
```

```bash
git add backend/src/connectors
git commit -m "feat: add Telegram webhook for live post ingestion"
```

---

## Task 11: SyncJob service and BullMQ queue

**Files:**
- Create: `backend/src/sync/sync-job.service.ts`
- Create: `backend/src/sync/sync-job.service.spec.ts`
- Create: `backend/src/sync/sync.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SyncJob`, `SyncTrigger`, `SyncStatus` from Task 4; `Account` from Task 4.
- Produces: `SyncJobService.createManual(accountId): Promise<SyncJob>`, `.createScheduledForAllActiveAccounts(): Promise<SyncJob[]>`, `.findById(id): Promise<SyncJob>` — enqueues onto BullMQ queue named `'sync'` with job data `{ syncJobId: string, accountId: string }`. The queue is consumed by the processor in Task 12.

- [ ] **Step 1: Install BullMQ**

```bash
cd backend
npm install @nestjs/bullmq bullmq
```

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/sync/sync-job.service.spec.ts
import { SyncJobService } from './sync-job.service';
import { SyncTrigger, SyncStatus } from '../db/entities/sync-job.entity';
import { AccountType, AccountPlatform } from '../db/entities/account.entity';

describe('SyncJobService', () => {
  it('createManual saves a pending job and enqueues it with priority', async () => {
    const saved = { id: 'job-1', accountId: 'acc-1', trigger: SyncTrigger.MANUAL, status: SyncStatus.PENDING };
    const syncJobsRepo = { save: jest.fn().mockResolvedValue(saved), create: jest.fn((x) => x) } as any;
    const queue = { add: jest.fn() } as any;
    const service = new SyncJobService(syncJobsRepo, queue);

    const result = await service.createManual('acc-1');

    expect(syncJobsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', trigger: SyncTrigger.MANUAL, status: SyncStatus.PENDING }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'sync-account',
      { syncJobId: 'job-1', accountId: 'acc-1' },
      { priority: 1 },
    );
    expect(result).toBe(saved);
  });

  it('createScheduledForAllActiveAccounts enqueues one job per active account with lower priority', async () => {
    const accounts = [
      { id: 'acc-1', isActive: true, platform: AccountPlatform.TELEGRAM, type: AccountType.OWN },
      { id: 'acc-2', isActive: true, platform: AccountPlatform.TELEGRAM, type: AccountType.OWN },
    ];
    const accountsRepo = { find: jest.fn().mockResolvedValue(accounts) } as any;
    const syncJobsRepo = {
      save: jest.fn().mockImplementation((x) => Promise.resolve({ id: `job-${x.accountId}`, ...x })),
      create: jest.fn((x) => x),
    } as any;
    const queue = { add: jest.fn() } as any;
    const service = new SyncJobService(syncJobsRepo, queue, accountsRepo);

    const result = await service.createScheduledForAllActiveAccounts();

    expect(result).toHaveLength(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith('sync-account', expect.anything(), { priority: 10 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- sync-job.service.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement the service**

```typescript
// backend/src/sync/sync-job.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { SyncJob, SyncTrigger, SyncStatus } from '../db/entities/sync-job.entity';
import { Account } from '../db/entities/account.entity';

@Injectable()
export class SyncJobService {
  constructor(
    @InjectRepository(SyncJob) private syncJobsRepo: Repository<SyncJob>,
    @InjectQueue('sync') private queue: Queue,
    @InjectRepository(Account) private accountsRepo?: Repository<Account>,
  ) {}

  async createManual(accountId: string): Promise<SyncJob> {
    return this.enqueue(accountId, SyncTrigger.MANUAL, 1);
  }

  async createScheduledForAllActiveAccounts(): Promise<SyncJob[]> {
    const accounts = await this.accountsRepo!.find({ where: { isActive: true } });
    const jobs: SyncJob[] = [];
    for (const account of accounts) {
      jobs.push(await this.enqueue(account.id, SyncTrigger.SCHEDULED, 10));
    }
    return jobs;
  }

  async findById(id: string): Promise<SyncJob | null> {
    return this.syncJobsRepo.findOneBy({ id });
  }

  private async enqueue(accountId: string, trigger: SyncTrigger, priority: number): Promise<SyncJob> {
    const job = await this.syncJobsRepo.save(
      this.syncJobsRepo.create({ accountId, trigger, status: SyncStatus.PENDING }),
    );
    await this.queue.add('sync-account', { syncJobId: job.id, accountId }, { priority });
    return job;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- sync-job.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Write the sync module registering the BullMQ queue**

```typescript
// backend/src/sync/sync.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncJob } from '../db/entities/sync-job.entity';
import { Account } from '../db/entities/account.entity';
import { SyncJobService } from './sync-job.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'sync' }),
    TypeOrmModule.forFeature([SyncJob, Account]),
  ],
  providers: [SyncJobService],
  exports: [SyncJobService],
})
export class SyncModule {}
```

Add BullMQ root connection config to `AppModule`:

```typescript
// backend/src/app.module.ts — add to imports
BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/sync backend/src/app.module.ts
git commit -m "feat: add SyncJobService with BullMQ queue"
```

---

## Task 12: Sync processor (worker)

**Files:**
- Create: `backend/src/sync/sync.processor.ts`
- Create: `backend/src/sync/sync.processor.spec.ts`
- Create: `backend/src/sync/er-calculator.ts`
- Create: `backend/src/sync/er-calculator.spec.ts`
- Modify: `backend/src/sync/sync.module.ts`

**Interfaces:**
- Consumes: `ConnectorRegistry` (Task 7), `AccountSnapshot`/`Post`/`SyncJob`/`SyncStatus` entities (Task 4).
- Produces: `calculateEr(likes, comments, shares, followersCount): number | null` — reused by Stats service (Task 15). `SyncProcessor` — a BullMQ `Processor` for queue `'sync'` handling job name `'sync-account'`; on completion writes an `AccountSnapshot` row, upserts `Post` rows, and updates the originating `SyncJob` to `success` or `failed` with `errorMessage`.

- [ ] **Step 1: Write the failing ER calculator test**

```typescript
// backend/src/sync/er-calculator.spec.ts
import { calculateEr } from './er-calculator';

describe('calculateEr', () => {
  it('computes engagement rate as a percentage of followers', () => {
    expect(calculateEr(50, 10, 5, 1000)).toBeCloseTo(6.5);
  });

  it('returns null when followers count is zero', () => {
    expect(calculateEr(10, 2, 1, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- er-calculator.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the calculator**

```typescript
// backend/src/sync/er-calculator.ts
export function calculateEr(
  likes: number,
  comments: number,
  shares: number,
  followersCount: number,
): number | null {
  if (followersCount <= 0) return null;
  return ((likes + comments + shares) / followersCount) * 100;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- er-calculator.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the failing processor test**

```typescript
// backend/src/sync/sync.processor.spec.ts
import { SyncProcessor } from './sync.processor';
import { SyncStatus } from '../db/entities/sync-job.entity';
import { AccountPlatform, AccountType } from '../db/entities/account.entity';
import { PostType } from '../db/entities/post.entity';

describe('SyncProcessor', () => {
  const account = {
    id: 'acc-1',
    platform: AccountPlatform.TELEGRAM,
    externalId: '@chan',
    name: 'Chan',
    type: AccountType.OWN,
    isActive: true,
  };

  function buildProcessor(overrides: Partial<{ getAccountStats: any; getPosts: any }> = {}) {
    const connector = {
      platform: AccountPlatform.TELEGRAM,
      getAccountInfo: jest.fn(),
      getAccountStats: overrides.getAccountStats ?? jest.fn().mockResolvedValue({ followersCount: 100, followingCount: null, postsCount: 3 }),
      getPosts: overrides.getPosts ?? jest.fn().mockResolvedValue([]),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) } as any;
    const snapshotsRepo = { upsert: jest.fn() } as any;
    const postsRepo = { upsert: jest.fn() } as any;
    const syncJobsRepo = { update: jest.fn() } as any;
    const processor = new SyncProcessor(registry, accountsRepo, snapshotsRepo, postsRepo, syncJobsRepo);
    return { processor, syncJobsRepo, snapshotsRepo, postsRepo };
  }

  it('on success, writes a snapshot and marks the job success', async () => {
    const { processor, syncJobsRepo, snapshotsRepo } = buildProcessor();

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    expect(snapshotsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', followersCount: 100 }),
      ['accountId', 'date'],
    );
    expect(syncJobsRepo.update).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: SyncStatus.SUCCESS }));
  });

  it('upserts posts returned by the connector with computed ER', async () => {
    const posts = [{
      externalPostId: 'p1', type: PostType.POST, publishedAt: new Date(), permalink: null,
      thumbnailUrl: null, caption: 'hi', likes: 10, comments: 5, shares: 0, views: null, reach: null,
    }];
    const { processor, postsRepo } = buildProcessor({ getPosts: jest.fn().mockResolvedValue(posts) });

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    expect(postsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ externalPostId: 'p1', er: 15 }),
      ['accountId', 'externalPostId'],
    );
  });

  it('on connector failure, marks the job failed with the error message', async () => {
    const { processor, syncJobsRepo } = buildProcessor({
      getAccountStats: jest.fn().mockRejectedValue(new Error('Forbidden: bot is not a member')),
    });

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    expect(syncJobsRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: SyncStatus.FAILED, errorMessage: 'Forbidden: bot is not a member' }),
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npm test -- sync.processor.spec.ts`
Expected: FAIL

- [ ] **Step 7: Implement the processor**

```typescript
// backend/src/sync/sync.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post } from '../db/entities/post.entity';
import { SyncJob, SyncStatus } from '../db/entities/sync-job.entity';
import { calculateEr } from './er-calculator';

interface SyncJobData {
  syncJobId: string;
  accountId: string;
}

@Processor('sync')
export class SyncProcessor extends WorkerHost {
  constructor(
    private registry: ConnectorRegistry,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountSnapshot) private snapshotsRepo: Repository<AccountSnapshot>,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
    @InjectRepository(SyncJob) private syncJobsRepo: Repository<SyncJob>,
  ) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    const { syncJobId, accountId } = job.data;
    await this.syncJobsRepo.update(syncJobId, { status: SyncStatus.RUNNING, startedAt: new Date() });

    try {
      const account = await this.accountsRepo.findOneBy({ id: accountId });
      if (!account) throw new Error(`Account ${accountId} not found`);

      const connector = this.registry.get(account.platform);
      const stats = await connector.getAccountStats(account);
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const posts = await connector.getPosts(account, since);

      const today = new Date().toISOString().slice(0, 10);
      let erSum = 0;
      let erCount = 0;

      for (const post of posts) {
        const er = calculateEr(post.likes, post.comments, post.shares, stats.followersCount);
        if (er !== null) {
          erSum += er;
          erCount += 1;
        }
        await this.postsRepo.upsert(
          { accountId, ...post, er, lastSyncedAt: new Date() },
          ['accountId', 'externalPostId'],
        );
      }

      await this.snapshotsRepo.upsert(
        {
          accountId,
          date: today,
          followersCount: stats.followersCount,
          followingCount: stats.followingCount,
          postsCount: stats.postsCount,
          avgReach: null,
          avgEr: erCount > 0 ? erSum / erCount : null,
        },
        ['accountId', 'date'],
      );

      await this.syncJobsRepo.update(syncJobId, { status: SyncStatus.SUCCESS, finishedAt: new Date() });
    } catch (error) {
      await this.syncJobsRepo.update(syncJobId, {
        status: SyncStatus.FAILED,
        errorMessage: (error as Error).message,
        finishedAt: new Date(),
      });
    }
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && npm test -- sync.processor.spec.ts`
Expected: PASS

- [ ] **Step 9: Register the processor in sync.module.ts and commit**

```typescript
// backend/src/sync/sync.module.ts — import ConnectorsModule, add TypeOrmModule.forFeature([Account, AccountSnapshot, Post, SyncJob])
// add SyncProcessor to providers
```

```bash
git add backend/src/sync
git commit -m "feat: add sync processor with error classification and ER calculation"
```

---

## Task 13: Scheduler (daily cron)

**Files:**
- Create: `backend/src/sync/sync.scheduler.ts`
- Create: `backend/src/sync/sync.scheduler.spec.ts`
- Modify: `backend/src/sync/sync.module.ts`

**Interfaces:**
- Consumes: `SyncJobService.createScheduledForAllActiveAccounts()` from Task 11.
- Produces: `SyncScheduler` — runs `@Cron('0 3 * * *')` (03:00 daily) calling `SyncJobService.createScheduledForAllActiveAccounts()`.

- [ ] **Step 1: Install @nestjs/schedule**

```bash
cd backend
npm install @nestjs/schedule
```

- [ ] **Step 2: Write the failing test**

```typescript
// backend/src/sync/sync.scheduler.spec.ts
import { SyncScheduler } from './sync.scheduler';

describe('SyncScheduler', () => {
  it('triggerDailySync delegates to SyncJobService', async () => {
    const syncJobService = { createScheduledForAllActiveAccounts: jest.fn().mockResolvedValue([]) } as any;
    const scheduler = new SyncScheduler(syncJobService);

    await scheduler.triggerDailySync();

    expect(syncJobService.createScheduledForAllActiveAccounts).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- sync.scheduler.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement the scheduler**

```typescript
// backend/src/sync/sync.scheduler.ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncJobService } from './sync-job.service';

@Injectable()
export class SyncScheduler {
  constructor(private syncJobService: SyncJobService) {}

  @Cron('0 3 * * *')
  async triggerDailySync(): Promise<void> {
    await this.syncJobService.createScheduledForAllActiveAccounts();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- sync.scheduler.spec.ts`
Expected: PASS

- [ ] **Step 6: Wire ScheduleModule and SyncScheduler into sync.module.ts, commit**

```typescript
// backend/src/app.module.ts — add ScheduleModule.forRoot() to imports
// backend/src/sync/sync.module.ts — add SyncScheduler to providers
```

```bash
git add backend/src/sync backend/src/app.module.ts
git commit -m "feat: add daily cron scheduler for account sync"
```

---

## Task 14: Sync controller — manual refresh and job status

**Files:**
- Create: `backend/src/sync/sync.controller.ts`
- Create: `backend/src/sync/sync.controller.spec.ts`
- Modify: `backend/src/sync/sync.module.ts`

**Interfaces:**
- Consumes: `SyncJobService` (Task 11), `JwtAuthGuard` (Task 5).
- Produces: `POST /accounts/:accountId/sync` → `SyncJob` (status `pending`). `GET /sync-jobs/:id` → `SyncJob` — polled by the frontend refresh button (Task 20).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/sync/sync.controller.spec.ts
import { SyncController } from './sync.controller';

describe('SyncController', () => {
  it('triggerManualSync delegates to SyncJobService.createManual', async () => {
    const job = { id: 'job-1' };
    const syncJobService = { createManual: jest.fn().mockResolvedValue(job), findById: jest.fn() } as any;
    const controller = new SyncController(syncJobService);

    const result = await controller.triggerManualSync('acc-1');

    expect(syncJobService.createManual).toHaveBeenCalledWith('acc-1');
    expect(result).toBe(job);
  });

  it('getStatus delegates to SyncJobService.findById', async () => {
    const job = { id: 'job-1', status: 'running' };
    const syncJobService = { createManual: jest.fn(), findById: jest.fn().mockResolvedValue(job) } as any;
    const controller = new SyncController(syncJobService);

    const result = await controller.getStatus('job-1');

    expect(syncJobService.findById).toHaveBeenCalledWith('job-1');
    expect(result).toBe(job);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- sync.controller.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the controller**

```typescript
// backend/src/sync/sync.controller.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- sync.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Register controller in sync.module.ts and commit**

```bash
git add backend/src/sync
git commit -m "feat: add manual sync trigger and job status endpoints"
```

---

## Task 15: Stats service — account detail

**Files:**
- Create: `backend/src/stats/stats.service.ts`
- Create: `backend/src/stats/stats.service.spec.ts`
- Create: `backend/src/stats/dto/post-filter.dto.ts`
- Create: `backend/src/stats/stats.module.ts`

**Interfaces:**
- Consumes: `AccountSnapshot`, `Post`, `Account` entities from Task 4.
- Produces: `StatsService.getAccountDetail(accountId, { from, to }): Promise<{ account, latestSnapshot, trend: AccountSnapshot[], posts: Post[] }>` and `StatsService.getTopPosts(accountId, { from, to, type? }, limit): Promise<Post[]>`. Both consumed by the Stats controller (Task 17) and by the frontend detail page (Task 20).

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/stats/stats.service.spec.ts
import { StatsService } from './stats.service';

describe('StatsService.getAccountDetail', () => {
  it('returns account, latest snapshot, trend, and posts within the period', async () => {
    const account = { id: 'acc-1', name: 'Chan' };
    const snapshots = [{ date: '2026-08-01', followersCount: 90 }, { date: '2026-08-13', followersCount: 100 }];
    const posts = [{ id: 'p1', publishedAt: new Date('2026-08-05') }];

    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) } as any;
    const snapshotsRepo = {
      find: jest.fn().mockResolvedValue(snapshots),
    } as any;
    const postsRepo = {
      find: jest.fn().mockResolvedValue(posts),
    } as any;

    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);
    const result = await service.getAccountDetail('acc-1', { from: '2026-08-01', to: '2026-08-13' });

    expect(result.account).toBe(account);
    expect(result.latestSnapshot).toEqual(snapshots[1]);
    expect(result.trend).toBe(snapshots);
    expect(result.posts).toBe(posts);
  });
});

describe('StatsService.getTopPosts', () => {
  it('orders by likes+comments+shares descending and applies the type filter', async () => {
    const postsRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'p1', type: 'post', likes: 10, comments: 1, shares: 0 },
        { id: 'p2', type: 'post', likes: 50, comments: 5, shares: 2 },
      ]),
    } as any;
    const accountsRepo = { findOneBy: jest.fn() } as any;
    const snapshotsRepo = { find: jest.fn() } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    const result = await service.getTopPosts('acc-1', { from: '2026-08-01', to: '2026-08-13', type: 'post' }, 5);

    expect(result[0].id).toBe('p2');
    expect(result[1].id).toBe('p1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- stats.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the DTO and service**

```typescript
// backend/src/stats/dto/post-filter.dto.ts
import { IsDateString, IsOptional, IsEnum } from 'class-validator';
import { PostType } from '../../db/entities/post.entity';

export class PeriodFilterDto {
  @IsDateString() from: string;
  @IsDateString() to: string;
}

export class PostFilterDto extends PeriodFilterDto {
  @IsOptional() @IsEnum(PostType) type?: PostType;
}
```

```typescript
// backend/src/stats/stats.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post, PostType } from '../db/entities/post.entity';

interface Period {
  from: string;
  to: string;
}

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountSnapshot) private snapshotsRepo: Repository<AccountSnapshot>,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
  ) {}

  async getAccountDetail(accountId: string, period: Period) {
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    const trend = await this.snapshotsRepo.find({
      where: { accountId, date: Between(period.from, period.to) },
      order: { date: 'ASC' },
    });
    const posts = await this.postsRepo.find({
      where: { accountId, publishedAt: Between(new Date(period.from), new Date(period.to)) },
      order: { publishedAt: 'DESC' },
    });

    return {
      account,
      latestSnapshot: trend.length > 0 ? trend[trend.length - 1] : null,
      trend,
      posts,
    };
  }

  async getTopPosts(accountId: string, filter: Period & { type?: PostType }, limit: number) {
    const where: any = { accountId, publishedAt: Between(new Date(filter.from), new Date(filter.to)) };
    if (filter.type) where.type = filter.type;

    const posts = await this.postsRepo.find({ where });
    return posts
      .sort((a, b) => b.likes + b.comments + b.shares - (a.likes + a.comments + a.shares))
      .slice(0, limit);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- stats.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write stats.module.ts and commit**

```typescript
// backend/src/stats/stats.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post } from '../db/entities/post.entity';
import { StatsService } from './stats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountSnapshot, Post])],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
```

```bash
git add backend/src/stats
git commit -m "feat: add stats service for account detail and top posts"
```

---

## Task 16: Stats service — overview and compare

**Files:**
- Modify: `backend/src/stats/stats.service.ts`
- Modify: `backend/src/stats/stats.service.spec.ts`

**Interfaces:**
- Consumes: same repos as Task 15.
- Produces: `StatsService.getOverview(): Promise<Array<{ account: Account; latestSnapshot: AccountSnapshot | null }>>` and `StatsService.compare(accountIds: string[], period: Period): Promise<Array<{ account: Account; trend: AccountSnapshot[] }>>` — consumed by Stats controller (Task 17) and the Overview/Compare frontend pages (Tasks 19, 22).

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/stats/stats.service.spec.ts — append to the existing file
describe('StatsService.getOverview', () => {
  it('returns every active account paired with its latest snapshot', async () => {
    const accounts = [{ id: 'acc-1' }, { id: 'acc-2' }];
    const accountsRepo = { find: jest.fn().mockResolvedValue(accounts), findOneBy: jest.fn() } as any;
    const snapshotsRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ accountId: 'acc-1', date: '2026-08-13', followersCount: 100 })
        .mockResolvedValueOnce(null),
      find: jest.fn(),
    } as any;
    const postsRepo = { find: jest.fn() } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    const result = await service.getOverview();

    expect(result).toEqual([
      { account: accounts[0], latestSnapshot: { accountId: 'acc-1', date: '2026-08-13', followersCount: 100 } },
      { account: accounts[1], latestSnapshot: null },
    ]);
  });
});

describe('StatsService.compare', () => {
  it('returns each requested account with its trend for the period', async () => {
    const accountsRepo = {
      findOneBy: jest
        .fn()
        .mockResolvedValueOnce({ id: 'acc-1' })
        .mockResolvedValueOnce({ id: 'acc-2' }),
      find: jest.fn(),
    } as any;
    const snapshotsRepo = { find: jest.fn().mockResolvedValue([{ date: '2026-08-13', followersCount: 100 }]) } as any;
    const postsRepo = { find: jest.fn() } as any;
    const service = new StatsService(accountsRepo, snapshotsRepo, postsRepo);

    const result = await service.compare(['acc-1', 'acc-2'], { from: '2026-08-01', to: '2026-08-13' });

    expect(result).toHaveLength(2);
    expect(result[0].account.id).toBe('acc-1');
    expect(result[0].trend).toEqual([{ date: '2026-08-13', followersCount: 100 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- stats.service.spec.ts`
Expected: FAIL (new describe blocks only)

- [ ] **Step 3: Add the methods to StatsService**

```typescript
// backend/src/stats/stats.service.ts — add inside the StatsService class
  async getOverview() {
    const accounts = await this.accountsRepo.find({ where: { isActive: true } });
    const result = [];
    for (const account of accounts) {
      const latestSnapshot = await this.snapshotsRepo.findOne({
        where: { accountId: account.id },
        order: { date: 'DESC' },
      });
      result.push({ account, latestSnapshot });
    }
    return result;
  }

  async compare(accountIds: string[], period: Period) {
    const result = [];
    for (const accountId of accountIds) {
      const account = await this.accountsRepo.findOneBy({ id: accountId });
      const trend = await this.snapshotsRepo.find({
        where: { accountId, date: Between(period.from, period.to) },
        order: { date: 'ASC' },
      });
      result.push({ account, trend });
    }
    return result;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- stats.service.spec.ts`
Expected: PASS (all describe blocks)

- [ ] **Step 5: Commit**

```bash
git add backend/src/stats
git commit -m "feat: add overview and compare methods to stats service"
```

---

## Task 17: Stats controller

**Files:**
- Create: `backend/src/stats/stats.controller.ts`
- Create: `backend/src/stats/stats.controller.spec.ts`
- Modify: `backend/src/stats/stats.module.ts`

**Interfaces:**
- Consumes: `StatsService` from Tasks 15-16, `JwtAuthGuard` from Task 5.
- Produces: `GET /stats/overview`, `GET /accounts/:id/detail?from&to`, `GET /accounts/:id/top-posts?from&to&type&limit`, `GET /stats/compare?accountIds=a,b&from&to` — all guarded, all consumed by the frontend (Tasks 19, 20, 22).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/stats/stats.controller.spec.ts
import { StatsController } from './stats.controller';

describe('StatsController', () => {
  function buildController(overrides: Partial<Record<string, jest.Mock>> = {}) {
    const statsService = {
      getOverview: overrides.getOverview ?? jest.fn().mockResolvedValue([]),
      getAccountDetail: overrides.getAccountDetail ?? jest.fn().mockResolvedValue({}),
      getTopPosts: overrides.getTopPosts ?? jest.fn().mockResolvedValue([]),
      compare: overrides.compare ?? jest.fn().mockResolvedValue([]),
    } as any;
    return new StatsController(statsService);
  }

  it('overview calls StatsService.getOverview', async () => {
    const controller = buildController();
    await controller.overview();
    expect(controller['statsService'].getOverview).toHaveBeenCalled();
  });

  it('detail passes accountId and period through', async () => {
    const controller = buildController();
    await controller.detail('acc-1', '2026-08-01', '2026-08-13');
    expect(controller['statsService'].getAccountDetail).toHaveBeenCalledWith('acc-1', { from: '2026-08-01', to: '2026-08-13' });
  });

  it('compare splits the comma-separated accountIds query param', async () => {
    const controller = buildController();
    await controller.compare('acc-1,acc-2', '2026-08-01', '2026-08-13');
    expect(controller['statsService'].compare).toHaveBeenCalledWith(['acc-1', 'acc-2'], { from: '2026-08-01', to: '2026-08-13' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- stats.controller.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the controller**

```typescript
// backend/src/stats/stats.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatsService } from './stats.service';
import { PostType } from '../db/entities/post.entity';

@UseGuards(JwtAuthGuard)
@Controller()
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('stats/overview')
  overview() {
    return this.statsService.getOverview();
  }

  @Get('accounts/:id/detail')
  detail(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    return this.statsService.getAccountDetail(id, { from, to });
  }

  @Get('accounts/:id/top-posts')
  topPosts(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type?: PostType,
    @Query('limit') limit = '10',
  ) {
    return this.statsService.getTopPosts(id, { from, to, type }, Number(limit));
  }

  @Get('stats/compare')
  compare(@Query('accountIds') accountIds: string, @Query('from') from: string, @Query('to') to: string) {
    return this.statsService.compare(accountIds.split(','), { from, to });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- stats.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Register controller, wire StatsModule + SyncModule + ConnectorsModule into AppModule, commit**

```typescript
// backend/src/stats/stats.module.ts — add controllers: [StatsController]
// backend/src/app.module.ts — add StatsModule, SyncModule, ConnectorsModule, AccountsModule to imports
```

```bash
git add backend/src/stats backend/src/app.module.ts
git commit -m "feat: add stats controller with overview/detail/top-posts/compare endpoints"
```

---

## Task 18: Frontend — API client, auth context, login page

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/auth/AuthContext.tsx`
- Create: `frontend/src/auth/AuthContext.test.tsx`
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/LoginPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `apiClient` (axios instance with base URL from `VITE_API_URL`, attaches `Authorization: Bearer <token>` from `AuthContext`). `useAuth(): { token: string | null; login(email, password): Promise<void>; logout(): void }`. `LoginPage` posts to `/auth/login` and redirects to `/` on success — consumed by every subsequent frontend task needing authenticated calls.

- [ ] **Step 1: Write the API client**

```typescript
// frontend/src/api/client.ts
import axios from 'axios';

export const apiClient = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000' });

export function setAuthToken(token: string | null) {
  if (token) apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete apiClient.defaults.headers.common['Authorization'];
}
```

- [ ] **Step 2: Write the failing AuthContext test**

```tsx
// frontend/src/auth/AuthContext.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({
  apiClient: { post: vi.fn() },
  setAuthToken: vi.fn(),
}));

function Consumer() {
  const { token, login } = useAuth();
  return (
    <div>
      <span>{token ?? 'no-token'}</span>
      <button onClick={() => login('a@b.com', 'password123')}>go</button>
    </div>
  );
}

describe('AuthContext', () => {
  it('stores the token returned by /auth/login', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { accessToken: 'tok123' } });
    render(<AuthProvider><Consumer /></AuthProvider>);

    fireEvent.click(screen.getByText('go'));

    await waitFor(() => expect(screen.getByText('tok123')).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run AuthContext.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement AuthContext**

```tsx
// frontend/src/auth/AuthContext.tsx
import { createContext, useContext, useState, ReactNode } from 'react';
import { apiClient, setAuthToken } from '../api/client';

interface AuthValue {
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('accessToken'));

  async function login(email: string, password: string) {
    const { data } = await apiClient.post('/auth/login', { email, password });
    localStorage.setItem('accessToken', data.accessToken);
    setAuthToken(data.accessToken);
    setToken(data.accessToken);
  }

  function logout() {
    localStorage.removeItem('accessToken');
    setAuthToken(null);
    setToken(null);
  }

  return <AuthContext.Provider value={{ token, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run AuthContext.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the failing LoginPage test**

```tsx
// frontend/src/pages/LoginPage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { AuthProvider } from '../auth/AuthContext';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({
  apiClient: { post: vi.fn() },
  setAuthToken: vi.fn(),
}));

describe('LoginPage', () => {
  it('submits email and password and shows an error on failure', async () => {
    (apiClient.post as any).mockRejectedValue({ response: { data: { message: 'Invalid credentials' } } });
    render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByText('Войти'));

    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument());
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npx vitest run LoginPage.test.tsx`
Expected: FAIL

- [ ] **Step 8: Implement LoginPage**

```tsx
// frontend/src/pages/LoginPage.tsx
import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Login failed');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="email">Email</label>
      <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Password</label>
      <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Войти</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npx vitest run LoginPage.test.tsx`
Expected: PASS

- [ ] **Step 10: Wrap App in AuthProvider, wire LoginPage into the route, commit**

```tsx
// frontend/src/App.tsx — wrap <Routes> in <AuthProvider>, replace the /login Placeholder with <LoginPage />
```

```bash
git add frontend/src
git commit -m "feat: add API client, auth context, and login page"
```

---

## Task 19: Frontend — Overview page

**Files:**
- Create: `frontend/src/pages/OverviewPage.tsx`
- Create: `frontend/src/pages/OverviewPage.test.tsx`
- Create: `frontend/src/components/AccountCard.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiClient` from Task 18; `GET /stats/overview` response shape `Array<{ account: { id, platform, name, avatarUrl, type }, latestSnapshot: { followersCount, avgEr } | null }>` from Task 17.
- Produces: `AccountCard` component (props: `account`, `latestSnapshot`) reused by the Compare page (Task 22) account picker.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/OverviewPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { OverviewPage } from './OverviewPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() } }));

describe('OverviewPage', () => {
  it('renders a card per account with followers and ER', async () => {
    (apiClient.get as any).mockResolvedValue({
      data: [
        { account: { id: 'acc-1', platform: 'telegram', name: 'Chan', avatarUrl: null, type: 'own' },
          latestSnapshot: { followersCount: 1234, avgEr: 3.2 } },
      ],
    });

    render(<MemoryRouter><OverviewPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Chan')).toBeInTheDocument());
    expect(screen.getByText('1234')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run OverviewPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement AccountCard and OverviewPage**

```tsx
// frontend/src/components/AccountCard.tsx
import { Link } from 'react-router-dom';

interface AccountCardProps {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export function AccountCard({ account, latestSnapshot }: AccountCardProps) {
  return (
    <Link to={`/accounts/${account.id}`} data-testid="account-card">
      <span>{account.platform}</span>
      <h3>{account.name}</h3>
      <span>{latestSnapshot ? latestSnapshot.followersCount : '—'}</span>
      <span>{latestSnapshot?.avgEr != null ? `${latestSnapshot.avgEr.toFixed(1)}%` : '—'}</span>
    </Link>
  );
}
```

```tsx
// frontend/src/pages/OverviewPage.tsx
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { AccountCard } from '../components/AccountCard';

interface OverviewItem {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export function OverviewPage() {
  const [items, setItems] = useState<OverviewItem[]>([]);

  useEffect(() => {
    apiClient.get('/stats/overview').then((res) => setItems(res.data));
  }, []);

  return (
    <div>
      {items.map((item) => (
        <AccountCard key={item.account.id} account={item.account} latestSnapshot={item.latestSnapshot} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run OverviewPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire into App.tsx route `/` and commit**

```bash
git add frontend/src
git commit -m "feat: add overview page with account cards"
```

---

## Task 20: Frontend — Account detail page

**Files:**
- Create: `frontend/src/pages/AccountDetailPage.tsx`
- Create: `frontend/src/pages/AccountDetailPage.test.tsx`
- Create: `frontend/src/components/PostList.tsx`
- Create: `frontend/src/components/PostTypeFilter.tsx`
- Create: `frontend/src/components/RefreshButton.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `GET /accounts/:id/detail`, `GET /accounts/:id/top-posts`, `POST /accounts/:id/sync`, `GET /sync-jobs/:id` from Tasks 14, 17.
- Produces: `PostList` (props: `posts`, reused nowhere else in this plan but designed to be platform-agnostic for later connector plans), `PostTypeFilter` (props: `value`, `onChange`), `RefreshButton` (props: `accountId`) — polls job status every 2s until `success`/`failed`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/AccountDetailPage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { AccountDetailPage } from './AccountDetailPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/accounts/:id" element={<AccountDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('AccountDetailPage', () => {
  it('shows account summary and post list filtered by type', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.includes('/detail')) {
        return Promise.resolve({
          data: {
            account: { id: 'acc-1', name: 'Chan' },
            latestSnapshot: { followersCount: 1000, avgEr: 4.1 },
            trend: [],
            posts: [
              { id: 'p1', type: 'post', caption: 'Hello', likes: 5, comments: 1, shares: 0, publishedAt: '2026-08-01' },
              { id: 'p2', type: 'video', caption: 'Video post', likes: 20, comments: 3, shares: 1, publishedAt: '2026-08-02' },
            ],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    renderAt('/accounts/acc-1');

    await waitFor(() => expect(screen.getByText('Chan')).toBeInTheDocument());
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Video post')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Тип поста'), { target: { value: 'video' } });

    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
    expect(screen.getByText('Video post')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run AccountDetailPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement PostTypeFilter, PostList, RefreshButton**

```tsx
// frontend/src/components/PostTypeFilter.tsx
const TYPES = ['post', 'reel', 'carousel', 'video', 'short', 'story'];

interface PostTypeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function PostTypeFilter({ value, onChange }: PostTypeFilterProps) {
  return (
    <label>
      Тип поста
      <select aria-label="Тип поста" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">Все</option>
        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </label>
  );
}
```

```tsx
// frontend/src/components/PostList.tsx
interface PostListProps {
  posts: Array<{ id: string; type: string; caption: string | null; likes: number; comments: number; shares: number; publishedAt: string }>;
}

export function PostList({ posts }: PostListProps) {
  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>
          <span>{post.caption}</span>
          <span>{post.likes} likes</span>
          <span>{post.comments} comments</span>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// frontend/src/components/RefreshButton.tsx
import { useState } from 'react';
import { apiClient } from '../api/client';

export function RefreshButton({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  async function handleClick() {
    const { data: job } = await apiClient.post(`/accounts/${accountId}/sync`);
    setStatus(job.status);
    const poll = setInterval(async () => {
      const { data: updated } = await apiClient.get(`/sync-jobs/${job.id}`);
      setStatus(updated.status);
      if (updated.status === 'success' || updated.status === 'failed') clearInterval(poll);
    }, 2000);
  }

  return (
    <div>
      <button onClick={handleClick}>Обновить сейчас</button>
      {status && <span>{status}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Implement AccountDetailPage**

```tsx
// frontend/src/pages/AccountDetailPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { PostList } from '../components/PostList';
import { PostTypeFilter } from '../components/PostTypeFilter';
import { RefreshButton } from '../components/RefreshButton';

interface DetailData {
  account: { id: string; name: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
  trend: unknown[];
  posts: Array<{ id: string; type: string; caption: string | null; likes: number; comments: number; shares: number; publishedAt: string }>;
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    apiClient.get(`/accounts/${id}/detail`, { params: { from, to } }).then((res) => setData(res.data));
  }, [id]);

  const filteredPosts = useMemo(() => {
    if (!data) return [];
    return typeFilter === 'all' ? data.posts : data.posts.filter((p) => p.type === typeFilter);
  }, [data, typeFilter]);

  if (!data) return <p>Загрузка…</p>;

  return (
    <div>
      <h2>{data.account.name}</h2>
      <p>Подписчики: {data.latestSnapshot?.followersCount ?? '—'}</p>
      <p>ER: {data.latestSnapshot?.avgEr != null ? `${data.latestSnapshot.avgEr.toFixed(1)}%` : '—'}</p>
      <RefreshButton accountId={data.account.id} />
      <PostTypeFilter value={typeFilter} onChange={setTypeFilter} />
      <PostList posts={filteredPosts} />
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run AccountDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Wire into App.tsx route `/accounts/:id` and commit**

```bash
git add frontend/src
git commit -m "feat: add account detail page with post type filter and manual refresh"
```

---

## Task 21: Frontend — Trend chart component

**Files:**
- Create: `frontend/src/components/TrendChart.tsx`
- Create: `frontend/src/components/TrendChart.test.tsx`
- Modify: `frontend/src/pages/AccountDetailPage.tsx`

**Interfaces:**
- Produces: `TrendChart` (props: `series: Array<{ label: string; data: Array<{ date: string; value: number }> }>`) — a single line per series, so it doubles as the single-account trend chart here and the multi-account overlay in the Compare page (Task 22).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/TrendChart.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrendChart } from './TrendChart';

describe('TrendChart', () => {
  it('renders one legend entry per series', () => {
    render(
      <TrendChart
        series={[
          { label: 'Chan A', data: [{ date: '2026-08-01', value: 100 }, { date: '2026-08-13', value: 150 }] },
          { label: 'Chan B', data: [{ date: '2026-08-01', value: 200 }, { date: '2026-08-13', value: 210 }] },
        ]}
      />,
    );

    expect(screen.getByText('Chan A')).toBeInTheDocument();
    expect(screen.getByText('Chan B')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run TrendChart.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement TrendChart using recharts**

```tsx
// frontend/src/components/TrendChart.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Series {
  label: string;
  data: Array<{ date: string; value: number }>;
}

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed'];

export function TrendChart({ series }: { series: Series[] }) {
  const dates = Array.from(new Set(series.flatMap((s) => s.data.map((d) => d.date)))).sort();
  const merged = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    series.forEach((s) => {
      const point = s.data.find((d) => d.date === date);
      row[s.label] = point ? point.value : NaN;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={merged}>
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Legend />
        {series.map((s, i) => (
          <Line key={s.label} type="monotone" dataKey={s.label} stroke={COLORS[i % COLORS.length]} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run TrendChart.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire into AccountDetailPage below the summary**

```tsx
// frontend/src/pages/AccountDetailPage.tsx — add after the RefreshButton:
<TrendChart series={[{ label: data.account.name, data: data.trend.map((s: any) => ({ date: s.date, value: s.followersCount })) }]} />
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat: add trend chart component and wire into account detail page"
```

---

## Task 22: Frontend — Compare page

**Files:**
- Create: `frontend/src/pages/ComparePage.tsx`
- Create: `frontend/src/pages/ComparePage.test.tsx`
- Create: `frontend/src/components/CompareTable.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `GET /stats/overview` (Task 17, for the account picker), `GET /stats/compare` (Task 17), `TrendChart` (Task 21).
- Produces: `CompareTable` (props: `rows: Array<{ account: {...}; latestSnapshot: {...} | null }>`).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/ComparePage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ComparePage } from './ComparePage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn() } }));

describe('ComparePage', () => {
  it('lets the user pick two accounts and shows a comparison table', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url.includes('/stats/overview')) {
        return Promise.resolve({
          data: [
            { account: { id: 'acc-1', name: 'Chan A', platform: 'telegram' }, latestSnapshot: { followersCount: 100, avgEr: 2 } },
            { account: { id: 'acc-2', name: 'Chan B', platform: 'telegram' }, latestSnapshot: { followersCount: 200, avgEr: 3 } },
          ],
        });
      }
      return Promise.resolve({
        data: [
          { account: { id: 'acc-1', name: 'Chan A' }, trend: [{ date: '2026-08-13', followersCount: 100 }] },
          { account: { id: 'acc-2', name: 'Chan B' }, trend: [{ date: '2026-08-13', followersCount: 200 }] },
        ],
      });
    });

    render(<MemoryRouter><ComparePage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByLabelText('Chan A')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Chan A'));
    fireEvent.click(screen.getByLabelText('Chan B'));

    await waitFor(() => expect(screen.getAllByText('Chan A').length).toBeGreaterThan(0));
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run ComparePage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement CompareTable**

```tsx
// frontend/src/components/CompareTable.tsx
interface CompareRow {
  account: { id: string; name: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export function CompareTable({ rows }: { rows: CompareRow[] }) {
  return (
    <table>
      <thead><tr><th>Аккаунт</th><th>Подписчики</th><th>ER</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.account.id}>
            <td>{row.account.name}</td>
            <td>{row.latestSnapshot?.followersCount ?? '—'}</td>
            <td>{row.latestSnapshot?.avgEr != null ? `${row.latestSnapshot.avgEr.toFixed(1)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Implement ComparePage**

```tsx
// frontend/src/pages/ComparePage.tsx
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { CompareTable } from '../components/CompareTable';
import { TrendChart } from '../components/TrendChart';

interface OverviewItem {
  account: { id: string; name: string; platform: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

interface CompareItem {
  account: { id: string; name: string };
  trend: Array<{ date: string; followersCount: number }>;
}

export function ComparePage() {
  const [candidates, setCandidates] = useState<OverviewItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<CompareItem[]>([]);

  useEffect(() => {
    apiClient.get('/stats/overview').then((res) => setCandidates(res.data));
  }, []);

  useEffect(() => {
    if (selected.length === 0) {
      setCompareData([]);
      return;
    }
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    apiClient
      .get('/stats/compare', { params: { accountIds: selected.join(','), from, to } })
      .then((res) => setCompareData(res.data));
  }, [selected]);

  function toggle(accountId: string) {
    setSelected((prev) => (prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]));
  }

  const rows = candidates.filter((c) => selected.includes(c.account.id));

  return (
    <div>
      {candidates.map((c) => (
        <label key={c.account.id}>
          <input type="checkbox" aria-label={c.account.name} onChange={() => toggle(c.account.id)} />
          {c.account.name}
        </label>
      ))}
      <CompareTable rows={rows} />
      <TrendChart
        series={compareData.map((item) => ({
          label: item.account.name,
          data: item.trend.map((t) => ({ date: t.date, value: t.followersCount })),
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run ComparePage.test.tsx`
Expected: PASS

- [ ] **Step 6: Wire into App.tsx route `/compare` and commit**

```bash
git add frontend/src
git commit -m "feat: add compare page with account picker, table, and overlaid trend chart"
```

---

## Task 23: End-to-end happy path

**Files:**
- Create: `e2e/dashboard.spec.ts`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/package.json`
- Create: `backend/src/db/seed.ts`

**Interfaces:**
- Consumes: the full running stack (backend on `:3000`, frontend on `:5173`, Postgres, Redis) via `docker compose up`.

- [ ] **Step 1: Write a seed script for a deterministic e2e fixture**

```typescript
// backend/src/db/seed.ts
import * as bcrypt from 'bcrypt';
import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';
import { Account, AccountPlatform, AccountType } from './entities/account.entity';
import { AccountSnapshot } from './entities/account-snapshot.entity';
import { Post, PostType } from './entities/post.entity';

async function seed() {
  await AppDataSource.initialize();

  const passwordHash = await bcrypt.hash('correct-horse', 10);
  await AppDataSource.getRepository(User).save({ email: 'e2e@agency.test', passwordHash, name: 'E2E User' });

  const account = await AppDataSource.getRepository(Account).save({
    platform: AccountPlatform.TELEGRAM,
    externalId: '@e2echannel',
    name: 'E2E Channel',
    avatarUrl: null,
    type: AccountType.OWN,
    isActive: true,
  });

  await AppDataSource.getRepository(AccountSnapshot).save({
    accountId: account.id,
    date: new Date().toISOString().slice(0, 10),
    followersCount: 500,
    followingCount: null,
    postsCount: 1,
    avgReach: null,
    avgEr: 4.2,
  });

  await AppDataSource.getRepository(Post).save({
    accountId: account.id,
    externalPostId: 'e2e-1',
    type: PostType.POST,
    publishedAt: new Date(),
    permalink: 'https://t.me/e2echannel/1',
    thumbnailUrl: null,
    caption: 'E2E seeded post',
    likes: 10,
    comments: 2,
    shares: 0,
    views: null,
    reach: null,
    er: 2.4,
    lastSyncedAt: new Date(),
  });

  await AppDataSource.destroy();
}

seed();
```

- [ ] **Step 2: Write the Playwright test**

```typescript
// e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';

test('login, view overview, open detail, filter posts, compare', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('e2e@agency.test');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByText('Войти').click();

  await expect(page.getByText('E2E Channel')).toBeVisible();
  await page.getByText('E2E Channel').click();

  await expect(page.getByText('E2E seeded post')).toBeVisible();
  await page.getByLabel('Тип поста').selectOption('video');
  await expect(page.getByText('E2E seeded post')).not.toBeVisible();

  await page.goto('/compare');
  await page.getByLabel('E2E Channel').click();
  await expect(page.getByText('500')).toBeVisible();
});
```

```typescript
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  use: { baseURL: 'http://localhost:5173' },
});
```

```json
{
  "name": "e2e",
  "devDependencies": { "@playwright/test": "^1.47.0" }
}
```

- [ ] **Step 3: Run migrations, seed, and execute the e2e suite**

Run: `docker compose up -d && cd backend && npm run migration:run && npx ts-node src/db/seed.ts && cd ../e2e && npm install && npx playwright install --with-deps && npx playwright test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add e2e backend/src/db/seed.ts
git commit -m "test: add end-to-end happy path covering login, detail filter, and compare"
```

---

## Self-Review Notes

- **Spec coverage:** overview/detail/compare pages (Task 18-22), summary metrics + per-post detail + top-posts + post-type filter (Task 15, 20), manual + scheduled refresh (Task 11-14), error handling for token/rate-limit/partial failure (Task 12), encrypted credential storage column present in schema (Task 4) — encryption/OAuth flow itself is deferred to the plan that adds the first connector requiring it (VK/YouTube/Instagram/LinkedIn), since Telegram's Bot API needs no OAuth.
- **Deferred to later plans (2-5):** VK/YouTube/Instagram/LinkedIn connectors, OAuth token refresh flow, AES encryption helper for `account_credentials.encryptedToken` (needed once a connector actually stores a token), token-expiry re-auth UI, role-based access (explicitly out of scope per spec §9).
- **Known limitation carried from spec:** Telegram in this plan has no reach/views and no historical post backfill — documented in `SocialConnector.getPosts` docstring and the Telegram connector test suite so it isn't mistaken for a bug later.
