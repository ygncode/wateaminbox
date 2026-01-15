---
title: Optimistic Updates for Mutations
impact: HIGH
impactDescription: instant perceived response
tags: query, tanstack-query, mutation, optimistic
---

## Optimistic Updates for Mutations

Update the UI immediately before the server confirms, then rollback on error.

**Incorrect (wait for server response):**

```tsx
function TodoItem({ todo }: { todo: Todo }) {
  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleTodo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })

  // User clicks, waits 200-500ms, then sees change
  return (
    <Checkbox
      checked={todo.completed}
      disabled={toggleMutation.isPending}
      onCheckedChange={() => toggleMutation.mutate(todo.id)}
    />
  )
}
```

**Correct (optimistic update):**

```tsx
function TodoItem({ todo }: { todo: Todo }) {
  const queryClient = useQueryClient()

  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleTodo(id),

    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['todos'] })

      // Snapshot previous value
      const previousTodos = queryClient.getQueryData<Todo[]>(['todos'])

      // Optimistically update
      queryClient.setQueryData<Todo[]>(['todos'], (old) =>
        old?.map(t =>
          t.id === id ? { ...t, completed: !t.completed } : t
        )
      )

      // Return context with snapshot
      return { previousTodos }
    },

    onError: (err, id, context) => {
      // Rollback on error
      queryClient.setQueryData(['todos'], context?.previousTodos)
    },

    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })

  // Change appears instantly
  return (
    <Checkbox
      checked={todo.completed}
      onCheckedChange={() => toggleMutation.mutate(todo.id)}
    />
  )
}
```

**Reusable optimistic mutation hook:**

```tsx
export function useOptimisticMutation<TData, TVariables, TContext>(
  options: UseMutationOptions<TData, Error, TVariables, TContext> & {
    queryKey: QueryKey
    updater: (old: TData | undefined, variables: TVariables) => TData
  }
) {
  const queryClient = useQueryClient()

  return useMutation({
    ...options,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: options.queryKey })
      const previous = queryClient.getQueryData<TData>(options.queryKey)
      queryClient.setQueryData<TData>(
        options.queryKey,
        (old) => options.updater(old, variables)
      )
      return { previous } as TContext
    },
    onError: (err, variables, context: any) => {
      queryClient.setQueryData(options.queryKey, context?.previous)
      options.onError?.(err, variables, context)
    },
    onSettled: (...args) => {
      queryClient.invalidateQueries({ queryKey: options.queryKey })
      options.onSettled?.(...args)
    },
  })
}
```

**With React 19 useOptimistic:**

```tsx
function TodoItem({ todo }: { todo: Todo }) {
  const [optimisticTodo, setOptimisticTodo] = useOptimistic(
    todo,
    (current, completed: boolean) => ({ ...current, completed })
  )

  const toggleMutation = useMutation({
    mutationFn: toggleTodo,
  })

  const handleToggle = async () => {
    setOptimisticTodo(!todo.completed)
    await toggleMutation.mutateAsync(todo.id)
  }

  return (
    <Checkbox
      checked={optimisticTodo.completed}
      onCheckedChange={handleToggle}
    />
  )
}
```
