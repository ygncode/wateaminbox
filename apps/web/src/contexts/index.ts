export {
  AuthProvider,
  useAuth,
  useHasRole,
  useIsAdmin,
  type AuthUser,
  type AuthState,
  type AuthContextValue,
  type AuthProviderProps,
  type UserRole,
} from "./auth-context";

export {
  WebSocketProvider,
  useWebSocketContext,
  type WebSocketContextValue,
} from "./WebSocketProvider";

export {
  KeyboardShortcutsProvider,
  useKeyboardShortcutsContext,
  useShortcutsEnabled,
  useRegisteredShortcuts,
  useRegisterShortcutAction,
  type KeyboardShortcutsState,
  type KeyboardShortcutsContextValue,
  type KeyboardShortcutsProviderProps,
} from "./KeyboardShortcutsContext";

export {
  ThemeProvider,
  useTheme,
  type Theme,
  type ResolvedTheme,
  type ThemeContextValue,
} from "./theme-context";
