---
title: Parallel Queries with useQueries
impact: CRITICAL
impactDescription: eliminates request waterfalls
tags: query, tanstack-query, parallel, waterfall
---

## Parallel Queries with useQueries

Use `useQueries` for multiple independent fetches to eliminate waterfalls.

**Incorrect (sequential, creates waterfall):**

```tsx
function Dashboard() {
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  // Only starts after users query completes (if dependent pattern used incorrectly)
  const { data: posts, isLoading: postsLoading } = useQuery({
    queryKey: ['posts'],
    queryFn: fetchPosts,
  })

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
  })

  if (usersLoading || postsLoading || statsLoading) {
    return <Loading />
  }
  // ...
}
```

**Correct (parallel with useQueries):**

```tsx
import { useQueries } from '@tanstack/react-query'

function Dashboard() {
  const results = useQueries({
    queries: [
      { queryKey: ['users'], queryFn: fetchUsers },
      { queryKey: ['posts'], queryFn: fetchPosts },
      { queryKey: ['stats'], queryFn: fetchStats },
    ],
  })

  const [users, posts, stats] = results
  const isLoading = results.some(r => r.isLoading)

  if (isLoading) return <Loading />

  return (
    <div>
      <UserList users={users.data} />
      <PostList posts={posts.data} />
      <StatsPanel stats={stats.data} />
    </div>
  )
}
```

**With query options factory:**

```tsx
function Dashboard() {
  const results = useQueries({
    queries: [
      userQueries.list({ limit: 10 }),
      postQueries.recent(),
      statsQueries.dashboard(),
    ],
  })

  // Type-safe destructuring
  const [
    { data: users, isLoading: usersLoading },
    { data: posts, isLoading: postsLoading },
    { data: stats, isLoading: statsLoading },
  ] = results

  // ...
}
```

**Dynamic parallel queries:**

```tsx
function UserProfiles({ userIds }: { userIds: string[] }) {
  const userQueries = useQueries({
    queries: userIds.map(id => ({
      queryKey: ['user', id],
      queryFn: () => fetchUser(id),
      staleTime: 5 * 60 * 1000,
    })),
  })

  const isLoading = userQueries.some(q => q.isLoading)
  const users = userQueries.map(q => q.data).filter(Boolean)

  if (isLoading) return <Loading />
  return <UserGrid users={users} />
}
```

**With combine for cleaner API:**

```tsx
const results = useQueries({
  queries: userIds.map(id => userQueries.detail(id)),
  combine: (results) => ({
    data: results.map(r => r.data).filter(Boolean),
    isLoading: results.some(r => r.isLoading),
    isError: results.some(r => r.isError),
  }),
})

// results.data is User[], results.isLoading is boolean
```
