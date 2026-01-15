---
title: Don't Subscribe to State Only Used in Callbacks
impact: MEDIUM
impactDescription: eliminates unnecessary re-renders
tags: rerender, zustand, selectors, callbacks
---

## Don't Subscribe to State Only Used in Callbacks

If state is only used inside event handlers or callbacks, access it directly instead of subscribing.

**Incorrect (subscribes to state only used in callback):**

```tsx
function SaveButton() {
  // Component re-renders every time items changes
  const items = useStore((state) => state.items)

  const handleSave = () => {
    // items only used here, not in render
    api.save(items)
  }

  return <Button onClick={handleSave}>Save</Button>
}
```

**Correct (read state directly in callback):**

```tsx
function SaveButton() {
  // No subscription - no re-renders when items change
  const handleSave = () => {
    // Read current state directly when needed
    const items = useStore.getState().items
    api.save(items)
  }

  return <Button onClick={handleSave}>Save</Button>
}
```

**With TanStack Query:**

```tsx
function RefreshButton() {
  const queryClient = useQueryClient()

  // Don't subscribe to query data just to invalidate
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] })
  }

  return <Button onClick={handleRefresh}>Refresh</Button>
}
```

**Zustand pattern with stable actions:**

```tsx
// Store definition - actions are stable references
const useStore = create<Store>((set, get) => ({
  items: [],
  saveItems: async () => {
    const items = get().items // Access current state
    await api.save(items)
  },
}))

function SaveButton() {
  // Actions don't cause re-renders
  const saveItems = useStore((state) => state.saveItems)

  return <Button onClick={saveItems}>Save</Button>
}
```

**When to subscribe vs direct access:**

```tsx
function CartSummary() {
  // SUBSCRIBE - needed for render output
  const total = useStore((state) =>
    state.items.reduce((sum, item) => sum + item.price, 0)
  )

  // DIRECT ACCESS - only needed in callback
  const handleCheckout = () => {
    const items = useStore.getState().items
    checkout(items)
  }

  return (
    <div>
      <span>Total: ${total}</span>
      <Button onClick={handleCheckout}>Checkout</Button>
    </div>
  )
}
```

**With refs for stable callback access:**

```tsx
function AutoSave() {
  const itemsRef = useRef<Item[]>([])

  // Update ref without re-render
  useEffect(() => {
    return useStore.subscribe(
      (state) => state.items,
      (items) => { itemsRef.current = items }
    )
  }, [])

  const handleSave = useCallback(() => {
    api.save(itemsRef.current)
  }, [])

  return <Button onClick={handleSave}>Save</Button>
}
```
