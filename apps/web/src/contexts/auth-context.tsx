import * as React from 'react'
import {
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type CompanyWithRole,
  clearAuthTokens,
  getAccessToken,
  getCompanyId,
  getCurrentUser,
  getUserCompanies,
  initializeAuth,
  type RegisterRequest,
  type RegisterResponse,
  setCompanyId,
} from '../lib/api'

export type UserRole = 'admin' | 'agent' | 'viewer'

export interface AuthUser {
  id: string
  email: string
  name: string
  avatarUrl?: string
  companyId: string
  role: UserRole
}

export interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  companies: CompanyWithRole[]
  currentCompanyId: string | null
  needsCompanySetup: boolean
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  register: (data: Omit<RegisterRequest, 'companyName'>) => Promise<RegisterResponse>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
  clearError: () => void
  selectCompany: (companyId: string) => void
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

export interface AuthProviderProps {
  children: React.ReactNode
}

// Helper to map API user to AuthUser
interface ApiUser {
  id: string
  email: string
  name?: string
  emailVerified?: boolean
}

function mapApiUserToAuthUser(
  apiUser: ApiUser,
  companyId?: string,
  role?: string
): AuthUser {
  return {
    id: apiUser.id,
    email: apiUser.email,
    name: apiUser.name || apiUser.email.split('@')[0],
    avatarUrl: undefined,
    companyId: companyId || '',
    role: (role as UserRole) || 'agent',
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = React.useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
    companies: [],
    currentCompanyId: null,
    needsCompanySetup: false,
  })

  // Check for existing session on mount
  React.useEffect(() => {
    const checkSession = async () => {
      try {
        initializeAuth()
        const token = getAccessToken()
        if (token) {
          // Validate token by fetching current user
          const apiUser = await getCurrentUser()

          // Fetch user's companies
          const companies = await getUserCompanies()
          const storedCompanyId = getCompanyId()

          // Use stored company ID if valid, otherwise use first company
          let currentCompanyId: string | null = null
          let currentRole: string | undefined
          if (storedCompanyId && companies.some((c) => c.id === storedCompanyId)) {
            currentCompanyId = storedCompanyId
            currentRole = companies.find((c) => c.id === storedCompanyId)?.role
          } else if (companies.length > 0) {
            currentCompanyId = companies[0].id
            currentRole = companies[0].role
            setCompanyId(currentCompanyId)
          }

          setState({
            user: mapApiUserToAuthUser(apiUser, currentCompanyId || undefined, currentRole),
            isAuthenticated: true,
            isLoading: false,
            error: null,
            companies,
            currentCompanyId,
            needsCompanySetup: companies.length === 0,
          })
        } else {
          setState((prev) => ({ ...prev, isLoading: false }))
        }
      } catch {
        // Token invalid or expired
        clearAuthTokens()
        setState((prev) => ({ ...prev, isLoading: false }))
      }
    }

    checkSession()
  }, [])

  const login = React.useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const response = await apiLogin({ email, password })

      // Fetch user's companies after login
      const companies = await getUserCompanies()

      // Set first company as current if available
      let currentCompanyId: string | null = null
      let currentRole: string | undefined
      if (companies.length > 0) {
        currentCompanyId = companies[0].id
        currentRole = companies[0].role
        setCompanyId(currentCompanyId)
      }

      setState({
        user: mapApiUserToAuthUser(response.user, currentCompanyId || undefined, currentRole),
        isAuthenticated: true,
        isLoading: false,
        error: null,
        companies,
        currentCompanyId,
        needsCompanySetup: companies.length === 0,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed'
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }))
      throw error
    }
  }, [])

  const register = React.useCallback(
    async (data: Omit<RegisterRequest, 'companyName'>): Promise<RegisterResponse> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        const response = await apiRegister(data)
        // Registration doesn't log user in - they need to verify email first
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: null,
        }))
        return response
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Registration failed'
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: message,
        }))
        throw error
      }
    },
    []
  )

  const logout = React.useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }))

    try {
      await apiLogout()
    } catch {
      // Ignore logout errors, clear local state anyway
    } finally {
      clearAuthTokens()
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        companies: [],
        currentCompanyId: null,
        needsCompanySetup: false,
      })
    }
  }, [])

  const selectCompany = React.useCallback(
    (companyId: string) => {
      const membership = state.companies.find((c) => c.id === companyId)
      if (membership) {
        setCompanyId(companyId)
        setState((prev) => ({
          ...prev,
          currentCompanyId: companyId,
        }))
      }
    },
    [state.companies]
  )

  const refreshSession = React.useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }))

    try {
      const token = getAccessToken()
      if (token) {
        const apiUser = await getCurrentUser()
        const companies = await getUserCompanies()
        const storedCompanyId = getCompanyId()

        let currentCompanyId: string | null = null
        let currentRole: string | undefined
        if (storedCompanyId && companies.some((c) => c.id === storedCompanyId)) {
          currentCompanyId = storedCompanyId
          currentRole = companies.find((c) => c.id === storedCompanyId)?.role
        } else if (companies.length > 0) {
          currentCompanyId = companies[0].id
          currentRole = companies[0].role
          setCompanyId(currentCompanyId)
        }

        setState({
          user: mapApiUserToAuthUser(apiUser, currentCompanyId || undefined, currentRole),
          isAuthenticated: true,
          isLoading: false,
          error: null,
          companies,
          currentCompanyId,
          needsCompanySetup: companies.length === 0,
        })
      } else {
        setState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
          companies: [],
          currentCompanyId: null,
          needsCompanySetup: false,
        })
      }
    } catch {
      clearAuthTokens()
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        companies: [],
        currentCompanyId: null,
        needsCompanySetup: false,
      })
    }
  }, [])

  const clearError = React.useCallback(() => {
    setState((prev) => ({ ...prev, error: null }))
  }, [])

  const value = React.useMemo(
    () => ({
      ...state,
      login,
      register,
      logout,
      refreshSession,
      clearError,
      selectCompany,
    }),
    [state, login, register, logout, refreshSession, clearError, selectCompany]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Hook for checking if user has specific role
export function useHasRole(allowedRoles: UserRole[]): boolean {
  const { user } = useAuth()
  if (!user) return false
  return allowedRoles.includes(user.role)
}

// Hook for checking if user is admin
export function useIsAdmin(): boolean {
  return useHasRole(['admin'])
}
