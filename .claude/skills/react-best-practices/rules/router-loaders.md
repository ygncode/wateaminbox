---
title: Use Loaders for Data Prefetching
impact: HIGH
impactDescription: eliminates loading states on navigation
tags: router, react-router, loaders, data
---

## Use Loaders for Data Prefetching

Use route loaders to fetch data before the route renders, eliminating loading spinners.

**Incorrect (fetch in component):**

```tsx
function UserProfile() {
  const { userId } = useParams()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchUser(userId).then(setUser).finally(() => setLoading(false))
  }, [userId])

  if (loading) return <Skeleton />
  return <Profile user={user} />
}

const router = createBrowserRouter([
  { path: '/user/:userId', element: <UserProfile /> },
])
```

**Correct (route loader):**

```tsx
import { useLoaderData, type LoaderFunctionArgs } from 'react-router'

// Loader runs before component renders
export async function userLoader({ params }: LoaderFunctionArgs) {
  const user = await fetchUser(params.userId!)
  return { user }
}

function UserProfile() {
  // Data is immediately available - no loading state needed
  const { user } = useLoaderData() as Awaited<ReturnType<typeof userLoader>>

  return <Profile user={user} />
}

const router = createBrowserRouter([
  {
    path: '/user/:userId',
    element: <UserProfile />,
    loader: userLoader,
  },
])
```

**Integrating with TanStack Query:**

```tsx
import { queryClient } from '@/lib/query'
import { userQueries } from '@/queries/users'

export async function userLoader({ params }: LoaderFunctionArgs) {
  const userId = params.userId!

  // Use ensureQueryData for cache-aware loading
  const user = await queryClient.ensureQueryData(userQueries.detail(userId))

  return { user }
}

function UserProfile() {
  const { user: initialUser } = useLoaderData() as { user: User }

  // Optional: keep data fresh with useQuery (uses cached data from loader)
  const { data: user } = useQuery({
    ...userQueries.detail(initialUser.id),
    initialData: initialUser,
  })

  return <Profile user={user} />
}
```

**Parallel loaders for complex pages:**

```tsx
export async function dashboardLoader() {
  // Parallel fetches - no waterfall
  const [user, stats, notifications] = await Promise.all([
    queryClient.ensureQueryData(userQueries.current()),
    queryClient.ensureQueryData(statsQueries.dashboard()),
    queryClient.ensureQueryData(notificationQueries.recent()),
  ])

  return { user, stats, notifications }
}
```

**Deferred data for non-critical content:**

```tsx
import { defer, Await } from 'react-router'

export async function dashboardLoader() {
  // Critical data - await before render
  const user = await queryClient.ensureQueryData(userQueries.current())

  // Non-critical - start fetch but don't block
  const analyticsPromise = queryClient.fetchQuery(analyticsQueries.summary())

  return defer({
    user,
    analytics: analyticsPromise,
  })
}

function Dashboard() {
  const { user, analytics } = useLoaderData() as {
    user: User
    analytics: Promise<Analytics>
  }

  return (
    <div>
      <UserHeader user={user} />
      <Suspense fallback={<AnalyticsSkeleton />}>
        <Await resolve={analytics}>
          {(data) => <AnalyticsPanel data={data} />}
        </Await>
      </Suspense>
    </div>
  )
}
```
