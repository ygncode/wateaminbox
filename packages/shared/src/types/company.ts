export interface Company {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  whatsappPhoneNumber?: string;
  whatsappBusinessAccountId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyInput {
  name: string;
  slug: string;
  logoUrl?: string;
  whatsappPhoneNumber?: string;
  whatsappBusinessAccountId?: string;
}

export interface UpdateCompanyInput {
  name?: string;
  slug?: string;
  logoUrl?: string;
  whatsappPhoneNumber?: string;
  whatsappBusinessAccountId?: string;
}
