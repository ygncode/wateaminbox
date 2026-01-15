---
title: Use useInfiniteQuery for Paginated Data
impact: HIGH
impactDescription: efficient infinite scroll and pagination
tags: query, tanstack-query, pagination, infinite
---

## Use useInfiniteQuery for Paginated Data

Use `useInfiniteQuery` for cursor-based pagination and infinite scroll patterns.

**Incorrect (manual pagination state):**

```tsx
function UserList() {
  const [page, setPage] = useState(1)
  const [allUsers, setAllUsers] = useState<User[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['users', page],
    queryFn: () => fetchUsers({ page }),
  })

  useEffect(() => {
    if (data) {
      setAllUsers(prev => [...prev, ...data.users])
    }
  }, [data])

  // Manual state management, no automatic caching of pages
}
```

**Correct (useInfiniteQuery):**

```tsx
import { useInfiniteQuery } from '@tanstack/react-query'

function UserList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['users'],
    queryFn: ({ pageParam }) => fetchUsers({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  // Flatten pages into single array
  const users = data?.pages.flatMap(page => page.users) ?? []

  return (
    <div>
      {users.map(user => (
        <UserCard key={user.id} user={user} />
      ))}

      {hasNextPage && (
        <Button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading...' : 'Load More'}
        </Button>
      )}
    </div>
  )
}
```

**Infinite scroll with Intersection Observer:**

```tsx
function InfiniteUserList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['users'],
    queryFn: ({ pageParam }) => fetchUsers({ cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  // Ref for the sentinel element
  const loadMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const users = data?.pages.flatMap(page => page.users) ?? []

  return (
    <div>
      {users.map(user => (
        <UserCard key={user.id} user={user} />
      ))}

      {/* Sentinel element */}
      <div ref={loadMoreRef} className="h-10">
        {isFetchingNextPage && <Spinner />}
      </div>
    </div>
  )
}
```

**Bidirectional infinite scroll:**

```tsx
const {
  data,
  fetchNextPage,
  fetchPreviousPage,
  hasNextPage,
  hasPreviousPage,
} = useInfiniteQuery({
  queryKey: ['messages', channelId],
  queryFn: ({ pageParam }) => fetchMessages({ cursor: pageParam }),
  initialPageParam: { direction: 'initial' },
  getNextPageParam: (lastPage) =>
    lastPage.hasMore ? { cursor: lastPage.nextCursor, direction: 'next' } : undefined,
  getPreviousPageParam: (firstPage) =>
    firstPage.hasPrevious ? { cursor: firstPage.prevCursor, direction: 'prev' } : undefined,
})
```

**With TanStack Virtual for performance:**

```tsx
function VirtualInfiniteList() {
  const parentRef = useRef<HTMLDivElement>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['items'],
      queryFn: ({ pageParam }) => fetchItems({ cursor: pageParam }),
      initialPageParam: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    })

  const allItems = data?.pages.flatMap(p => p.items) ?? []

  const virtualizer = useVirtualizer({
    count: hasNextPage ? allItems.length + 1 : allItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 5,
  })

  useEffect(() => {
    const [lastItem] = [...virtualizer.getVirtualItems()].reverse()
    if (!lastItem) return

    if (
      lastItem.index >= allItems.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage()
    }
  }, [
    virtualizer.getVirtualItems(),
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    allItems.length,
  ])

  // Render virtualized list...
}
```

Reference: [TanStack Query Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)
