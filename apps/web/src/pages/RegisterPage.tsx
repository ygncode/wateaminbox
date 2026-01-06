import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../components/ui/button'
import { FormField } from '../components/ui/form-field'
import { useAuth } from '../contexts/auth-context'
import { registerSchema, type RegisterFormData } from '../lib/schemas'

export function RegisterPage() {
  const navigate = useNavigate()
  const { register: registerUser, isLoading, error, clearError, isAuthenticated } = useAuth()
  const [registrationSuccess, setRegistrationSuccess] = React.useState(false)
  const [registeredEmail, setRegisteredEmail] = React.useState('')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  })

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/chat')
    }
  }, [isAuthenticated, navigate])

  const onSubmit = async (data: RegisterFormData) => {
    clearError()
    try {
      await registerUser({ name: data.name, email: data.email, password: data.password })
      setRegisteredEmail(data.email)
      setRegistrationSuccess(true)
    } catch {
      // Error is handled by auth context
    }
  }

  // Show success message after registration
  if (registrationSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
        <div className="w-full max-w-md">
          <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#25D366] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-10 h-10 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-2">
                Check your email
              </h1>
              <p className="text-gray-600 dark:text-dark-text-secondary mb-6">
                We've sent a verification link to <strong>{registeredEmail}</strong>. Please check your email
                and click the link to verify your account.
              </p>
              <Link
                to="/login"
                className="inline-block w-full py-2 px-4 bg-whatsapp-green-a11y-button hover:bg-whatsapp-green-a11y-button/90 dark:bg-whatsapp-green-a11y-button dark:hover:bg-whatsapp-green-a11y-button/90 text-white font-medium rounded-lg transition-colors text-center"
              >
                Go to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[#25D366] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
              Create account
            </h1>
            <p className="text-gray-600 dark:text-dark-text-secondary mt-2">
              Get started with WhatsApp Web
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <FormField
              label="Full name"
              id="name"
              type="text"
              placeholder="John Doe"
              registration={register('name')}
              error={errors.name}
              autoComplete="name"
            />

            <FormField
              label="Email"
              id="email"
              type="email"
              placeholder="you@example.com"
              registration={register('email')}
              error={errors.email}
              autoComplete="email"
            />

            <FormField
              label="Password"
              id="password"
              type="password"
              placeholder="At least 8 characters"
              registration={register('password')}
              error={errors.password}
              autoComplete="new-password"
            />

            <FormField
              label="Confirm password"
              id="confirmPassword"
              type="password"
              placeholder="Confirm your password"
              registration={register('confirmPassword')}
              error={errors.confirmPassword}
              autoComplete="new-password"
            />

            <Button
              type="submit"
              className="w-full bg-whatsapp-green-a11y-button hover:bg-whatsapp-green-a11y-button/90 dark:bg-whatsapp-green-a11y-button dark:hover:bg-whatsapp-green-a11y-button/90 text-white"
              disabled={isLoading}
            >
              {isLoading ? 'Creating account...' : 'Create account'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 dark:text-dark-text-secondary">
              Already have an account?{' '}
              <Link to="/login" className="text-whatsapp-green-a11y-text dark:text-whatsapp-green hover:text-whatsapp-green-a11y-button dark:hover:text-whatsapp-green/80 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
