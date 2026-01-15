---
title: Use TanStack Virtual for Long Lists
impact: HIGH
impactDescription: renders only visible items
tags: rendering, virtualization, tanstack-virtual, performance
---

## Use TanStack Virtual for Long Lists

Virtualize lists with 100+ items using TanStack Virtual to render only visible elements.

**Incorrect (renders all items):**

```tsx
function UserList({ users }: { users: User[] }) {
  // 1000 users = 1000 DOM nodes = slow
  return (
    <div className="h-[600px] overflow-auto">
      {users.map(user => (
        <div key={user.id} className="h-16 p-4 border-b">
          <UserCard user={user} />
        </div>
      ))}
    </div>
  )
}
```

**Correct (virtualized list):**

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

function UserList({ users }: { users: User[] }) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64, // Estimated row height
    overscan: 5, // Render 5 extra items above/below viewport
  })

  return (
    <div
      ref={parentRef}
      className="h-[600px] overflow-auto"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <UserCard user={users[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Variable height items:**

```tsx
function MessageList({ messages }: { messages: Message[] }) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Initial estimate

    // Measure actual size after render
    measureElement: (element) => element.getBoundingClientRect().height,
  })

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <MessageBubble message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Virtualized grid:**

```tsx
function ImageGrid({ images }: { images: Image[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const columns = 4

  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(images.length / columns),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 2,
  })

  return (
    <div ref={parentRef} className="h-[800px] overflow-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columns
          const rowImages = images.slice(startIndex, startIndex + columns)

          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 w-full grid grid-cols-4 gap-2"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {rowImages.map((image, i) => (
                <ImageCard key={image.id} image={image} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

**With infinite scroll (TanStack Query):**

```tsx
function InfiniteUserList() {
  const parentRef = useRef<HTMLDivElement>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['users'],
      queryFn: ({ pageParam }) => fetchUsers({ cursor: pageParam }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    })

  const allUsers = data?.pages.flatMap((p) => p.users) ?? []

  const virtualizer = useVirtualizer({
    count: hasNextPage ? allUsers.length + 1 : allUsers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1]
    if (!lastItem) return

    if (
      lastItem.index >= allUsers.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage()
    }
  }, [virtualItems, hasNextPage, isFetchingNextPage, fetchNextPage, allUsers.length])

  // Render virtualized list...
}
```

Reference: [TanStack Virtual](https://tanstack.com/virtual/latest)
