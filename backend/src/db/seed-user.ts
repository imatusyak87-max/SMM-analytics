import 'reflect-metadata';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';

export async function seedUser(
  usersRepo: Repository<User>,
  email: string,
  password: string,
  name: string,
): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 10);
  await usersRepo.upsert({ email, passwordHash, name }, ['email']);
}

async function main() {
  const [, , email, password, name] = process.argv;
  if (!email || !password) {
    console.error('Usage: seed-user <email> <password> [name]');
    process.exit(1);
  }
  await AppDataSource.initialize();
  try {
    await seedUser(AppDataSource.getRepository(User), email, password, name ?? 'Admin');
    console.log(`Seeded user ${email}`);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
