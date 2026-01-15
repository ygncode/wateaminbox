---
title: Handle Async Submission with TanStack Query
impact: MEDIUM
impactDescription: consistent loading/error states
tags: form, react-hook-form, tanstack-query, mutation
---

## Handle Async Submission with TanStack Query

Use TanStack Query mutations for form submissions to get loading states, error handling, and cache invalidation.

**Incorrect (manual fetch in submit handler):**

```tsx
function ContactForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { handleSubmit } = useForm<ContactData>({
    resolver: zodResolver(contactSchema),
  })

  const onSubmit = async (data: ContactData) => {
    setLoading(true)
    setError(null)
    try {
      await fetch('/api/contact', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      // No cache invalidation, no optimistic updates
    } catch (e) {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {error && <Alert>{error}</Alert>}
      {/* ... */}
    </form>
  )
}
```

**Correct (TanStack Query mutation):**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'

function ContactForm() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (data: ContactData) =>
      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(res => {
        if (!res.ok) throw new Error('Failed to submit')
        return res.json()
      }),
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
  })

  const {
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactData>({
    resolver: zodResolver(contactSchema),
  })

  const onSubmit = (data: ContactData) => {
    mutation.mutate(data, {
      onSuccess: () => reset(),
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {mutation.isError && (
        <Alert variant="destructive">
          {mutation.error.message}
        </Alert>
      )}

      {mutation.isSuccess && (
        <Alert>Message sent successfully!</Alert>
      )}

      {/* Form fields */}

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Sending...' : 'Send Message'}
      </Button>
    </form>
  )
}
```

**Reusable form submission hook:**

```tsx
export function useFormMutation<TData, TVariables>(
  options: UseMutationOptions<TData, Error, TVariables>
) {
  const mutation = useMutation(options)

  const submitHandler = <TForm extends TVariables>(
    form: UseFormReturn<TForm>,
    onSuccess?: () => void
  ) => {
    return form.handleSubmit((data) => {
      mutation.mutate(data as TVariables, {
        onSuccess: () => {
          form.reset()
          onSuccess?.()
        },
      })
    })
  }

  return { mutation, submitHandler }
}

// Usage
function CreateUserForm() {
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
  })

  const { mutation, submitHandler } = useFormMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all })
    },
  })

  return (
    <form onSubmit={submitHandler(form)}>
      {/* Form fields */}
    </form>
  )
}
```

**With optimistic UI:**

```tsx
const mutation = useMutation({
  mutationFn: updateProfile,
  onMutate: async (newProfile) => {
    await queryClient.cancelQueries({ queryKey: ['profile'] })
    const previous = queryClient.getQueryData(['profile'])
    queryClient.setQueryData(['profile'], newProfile)
    return { previous }
  },
  onError: (err, variables, context) => {
    queryClient.setQueryData(['profile'], context?.previous)
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['profile'] })
  },
})
```
