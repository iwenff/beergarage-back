export enum Role {
  CLIENT = 'CLIENT',
  STAFF = 'STAFF',
  ADMIN = 'ADMIN',
}

export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

export type JwtPayload = {
  sub: number;
  email: string;
  role: string;
};

export type AuthenticatedUser = {
  id: number;
  email: string;
  role: string;
};
