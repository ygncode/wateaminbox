export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  companyId: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = "admin" | "agent" | "viewer";

export interface CreateUserInput {
  email: string;
  name: string;
  avatarUrl?: string;
  companyId: string;
  role: UserRole;
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  avatarUrl?: string;
  role?: UserRole;
}
