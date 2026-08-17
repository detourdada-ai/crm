import "server-only";
import { driversRepository, type DriverUpdate } from "@/lib/repositories/drivers.repository";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { membershipsRepository } from "@/lib/repositories/memberships.repository";
import { hashPassword } from "@/lib/auth/password";
import type { Driver } from "@/types/domain";

export class DriverServiceError extends Error {}

export interface CreateDriverInput {
  name: string;
  phone: string | null;
  address: string | null;
  vehicleNumber: string | null;
  ratePerDelivery: number;
  username: string;
  password: string;
  ownerUsername: string;
}

/** Creates a driver row + its login account together — a driver account only ever exists tied to exactly one driver row. */
export async function createDriverWithAccount(input: CreateDriverInput): Promise<Driver> {
  const existingAccount = await accountsRepository.findByUsername(input.username);
  if (existingAccount) throw new DriverServiceError("이미 사용 중인 아이디입니다.");

  const tenant = await tenantsRepository.findByUsername(input.ownerUsername);
  if (!tenant) throw new DriverServiceError(`No tenant membership found for account "${input.ownerUsername}".`);

  const driver = await driversRepository.create({
    name: input.name,
    phone: input.phone,
    address: input.address,
    vehicle_number: input.vehicleNumber,
    rate_per_delivery: input.ratePerDelivery,
    owner_username: input.ownerUsername,
    tenant_id: tenant.id,
  });

  try {
    await accountsRepository.createDriverAccount(input.username, hashPassword(input.password), driver.id);
    await membershipsRepository.create({ username: input.username, tenant_id: tenant.id, role: "DRIVER" });
  } catch (e) {
    // Keep account + driver in sync — don't leave an orphaned driver row if the account failed to create.
    await driversRepository.update(driver.id, { status: "inactive" });
    throw e;
  }

  return driver;
}

export async function updateDriver(id: string, input: DriverUpdate, ownerUsername?: string): Promise<Driver> {
  return driversRepository.update(id, input, ownerUsername);
}
