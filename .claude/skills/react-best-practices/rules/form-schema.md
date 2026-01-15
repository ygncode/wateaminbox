---
title: Define Zod Schemas for Type-Safe Validation
impact: MEDIUM
impactDescription: type-safe forms, single source of truth
tags: form, react-hook-form, zod, validation
---

## Define Zod Schemas for Type-Safe Validation

Use Zod schemas as the single source of truth for form validation and TypeScript types.

**Incorrect (separate types and validation):**

```tsx
// Types defined separately
interface UserForm {
  email: string
  password: string
  age: number
}

function SignupForm() {
  const { register, handleSubmit } = useForm<UserForm>()

  const onSubmit = (data: UserForm) => {
    // Manual validation
    if (!data.email.includes('@')) {
      // ...
    }
    if (data.password.length < 8) {
      // ...
    }
  }
}
```

**Correct (Zod schema as source of truth):**

```tsx
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

// Schema defines both validation AND type
const signupSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  age: z
    .number({ invalid_type_error: 'Age must be a number' })
    .min(18, 'Must be at least 18 years old')
    .max(120, 'Invalid age'),
})

// Infer type from schema - always in sync
type SignupForm = z.infer<typeof signupSchema>

function SignupForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: '',
      password: '',
      age: undefined,
    },
  })

  const onSubmit = (data: SignupForm) => {
    // data is fully validated and typed
    console.log(data.email) // string
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Input {...register('email')} />
      {errors.email && <Error>{errors.email.message}</Error>}

      <Input type="password" {...register('password')} />
      {errors.password && <Error>{errors.password.message}</Error>}

      <Input
        type="number"
        {...register('age', { valueAsNumber: true })}
      />
      {errors.age && <Error>{errors.age.message}</Error>}

      <Button type="submit">Sign Up</Button>
    </form>
  )
}
```

**Complex schemas with refinements:**

```tsx
const passwordSchema = z
  .object({
    password: z.string().min(8),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

const profileSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, and underscores'),
  bio: z.string().max(500).optional(),
  website: z.string().url().optional().or(z.literal('')),
  birthdate: z.coerce.date().max(new Date(), 'Cannot be in the future'),
})
```

**Reusable schema parts:**

```tsx
// schemas/common.ts
export const emailSchema = z
  .string()
  .min(1, 'Required')
  .email('Invalid email')

export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')

// schemas/auth.ts
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Required'),
})

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(2, 'At least 2 characters'),
})
```
