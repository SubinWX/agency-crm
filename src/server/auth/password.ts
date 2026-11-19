import bcrypt from "bcryptjs";

const ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Minimum policy: 8+ chars with a letter and a number. */
export function passwordPolicyError(plain: string): string | null {
  if (plain.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) return "Password must contain a letter and a number.";
  return null;
}

let dummy: string | null = null;
/** A real hash used to equalise timing when the email does not exist. */
export function dummyHash(): string {
  if (!dummy) dummy = bcrypt.hashSync("not-a-real-password", ROUNDS);
  return dummy;
}
