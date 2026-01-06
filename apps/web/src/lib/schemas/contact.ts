import { z } from 'zod'

/**
 * Phone number validation helper
 */
const phoneNumberRegex = /^\+?[\d\s-]{7,16}$/

/**
 * Add contact form validation schema
 */
export const addContactSchema = z.object({
  phoneNumber: z
    .string()
    .min(1, 'Phone number is required')
    .regex(phoneNumberRegex, 'Please enter a valid phone number with country code')
    .transform((val) => val.replace(/[^\d+]/g, ''))
    .refine(
      (val) => val.length >= 7 && val.length <= 16,
      'Phone number must be between 7 and 16 digits'
    ),
  customName: z
    .string()
    .max(100, 'Name must be less than 100 characters')
    .optional(),
  notes: z
    .string()
    .max(500, 'Notes must be less than 500 characters')
    .optional(),
})

export type AddContactFormData = z.infer<typeof addContactSchema>
