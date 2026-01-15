---
title: Use useSuspenseQuery with React 19 Suspense
impact: HIGH
impactDescription: cleaner loading states, streaming
tags: query, tanstack-query, suspense, react-19
---

## Use useSuspenseQuery with React 19 Suspense

Use `useSuspenseQuery` for declarative loading states and React 19's streaming capabilities.

**Incorrect (manual loading state handling):**

```tsx
function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  })

  if (isLoading) return <Skeleton />
  if (error) return <ErrorMessage error={error} />
  if (!user) return null

  // TypeScript doesn't know user is defined here without narrowing
  return <Profile user={user} />
}
```

**Correct (Suspense boundary handles loading):**

```tsx
import { useSuspenseQuery } from '@tanstack/react-query'

function UserProfile({ userId }: { userId: string }) {
  // data is guaranteed to be defined - no loading check needed
  const { data: user } = useSuspenseQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  })

  return <Profile user={user} />
}

// Parent handles loading state
function UserPage({ userId }: { userId: string }) {
  return (
    <ErrorBoundary fallback={<ErrorMessage />}>
      <Suspense fallback={<Skeleton />}>
        <UserProfile userId={userId} />
      </Suspense>
    </ErrorBoundary>
  )
}
```

**Multiple Suspense boundaries for progressive loading:**

```tsx
function Dashboard() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Suspense fallback={<CardSkeleton />}>
        <StatsCard />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <RecentActivity />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <QuickActions />
      </Suspense>
    </div>
  )
}

// Each card loads independently - no waterfall
function StatsCard() {
  const { data } = useSuspenseQuery(statsQueries.summary())
  return <Card>{/* render stats */}</Card>
}
```

**Parallel suspense queries:**

```tsx
import { useSuspenseQueries } from '@tanstack/react-query'

function UserDashboard({ userId }: { userId: string }) {
  const [{ data: user }, { data: posts }, { data: followers }] =
    useSuspenseQueries({
      queries: [
        userQueries.detail(userId),
        postQueries.byUser(userId),
        followerQueries.byUser(userId),
      ],
    })

  // All data guaranteed to be available
  return (
    <div>
      <UserHeader user={user} />
      <PostList posts={posts} />
      <FollowerList followers={followers} />
    </div>
  )
}
```

**With React 19 use() for promise unwrapping:**

```tsx
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise)
  return <Profile user={user} />
}

// Parent starts fetch early
function UserPage({ userId }: { userId: string }) {
  const userPromise = useMemo(
    () => queryClient.fetchQuery(userQueries.detail(userId)),
    [userId]
  )

  return (
    <Suspense fallback={<Skeleton />}>
      <UserProfile userPromise={userPromise} />
    </Suspense>
  )
}
```

Reference: [TanStack Query Suspense](https://tanstack.com/query/latest/docs/framework/react/guides/suspense)
